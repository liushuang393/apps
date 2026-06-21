/**
 * VoiceTranslate Pro 2.0 - WebSocket & Audio Processing Mixin
 *
 * 目的:
 *   WebSocketメッセージ処理と音声処理ロジックを分離
 *   メインクラスの複雑度を軽減し、保守性を向上
 *
 * 依存:
 *   - voicetranslate-utils.js: CONFIG, AudioUtils
 *   - voicetranslate-audio-queue.js: AudioSegment, AudioQueue
 *
 * 使用方法:
 *   Object.assign(VoiceTranslateApp.prototype, WebSocketMixin);
 */

const WebSocketMixin = {
    /**
     * WebSocketメッセージ送信
     *
     * 目的:
     *   Electron環境とブラウザ環境の両方に対応したメッセージ送信
     *
     * 入力:
     *   message: 送信するメッセージオブジェクト
     */
    async sendMessage(message) {
        if (this.platform.isElectron) {
            // Electron環境（mainプロセス経由IPC）
            const result = await this.platform.sendRealtime(message);
            if (!result.success) {
                console.error('[Send Message] Electron送信エラー:', result.message);
            }
        } else if (this.state.ws && this.state.ws.readyState === WebSocket.OPEN) {
            // ブラウザ環境
            this.state.ws.send(JSON.stringify(message));
        }
    },

    /**
     * WebSocketメッセージ受信処理
     *
     * 目的:
     *   受信したメッセージをパースしてディスパッチ
     *
     * 入力:
     *   event: WebSocketメッセージイベント
     */
    async handleWSMessage(event) {
        try {
            const message = JSON.parse(event.data);

            // デバッグモードでのみ詳細ログを出力
            if (CONFIG.DEBUG_MODE) {
                console.info('[WS Message]', message.type, message);
            }

            // メッセージタイプに応じたハンドラーを呼び出す
            this.dispatchWSMessage(message);
        } catch (error) {
            console.error('[Message Error]', error);
            console.error('[Message Error] Event data:', event.data);
        }
    },

    /**
     * WebSocketメッセージをディスパッチ
     *
     * 目的:
     *   メッセージタイプに応じて適切なハンドラーを呼び出す
     *
     * 入力:
     *   message: WebSocketメッセージオブジェクト
     */
    dispatchWSMessage(message) {
        switch (message.type) {
            case 'session.updated':
                this.handleSessionUpdated(message);
                break;
            case 'input_audio_buffer.committed':
                this.handleAudioBufferCommitted(message);
                break;
            case 'input_audio_buffer.speech_started':
                this.handleSpeechStarted();
                break;
            case 'input_audio_buffer.speech_stopped':
                this.handleSpeechStopped();
                break;
            case 'conversation.item.input_audio_transcription.completed':
                this.handleTranscriptionCompleted(message);
                break;
            // GA: response.audio_transcript.* → response.output_audio_transcript.*
            case 'response.output_audio_transcript.delta':
                this.handleAudioTranscriptDelta(message);
                break;
            case 'response.output_audio_transcript.done':
                this.handleAudioTranscriptDone();
                break;
            // GA: response.audio.* → response.output_audio.*
            case 'response.output_audio.delta':
                this.handleAudioDelta(message);
                break;
            case 'response.output_audio.done':
                this.handleAudioDone();
                break;
            case 'response.created':
                this.handleResponseCreated(message);
                break;
            case 'response.done':
                this.handleResponseDone(message);
                break;
            case 'error':
                this.handleWSMessageError(message);
                break;
            default:
                console.info('[WS Message] 未処理のメッセージタイプ:', message.type);
        }
    },

    /**
     * セッション更新イベント処理
     */
    handleSessionUpdated(message) {
        console.info('[Session] Updated:', message.session);
    },

    /**
     * 音声バッファコミット完了処理
     *
     * 目的:
     *   音声バッファがコミットされた際の処理
     *   重複チェック、発話時長検証、音声データ抽出を実行
     */
    handleAudioBufferCommitted() {
        const queueStatus = this.responseQueue.getStatus();
        const now = Date.now();
        const speechDuration = this.speechStartTime ? now - this.speechStartTime : 0;

        console.info('[Audio] 音声バッファコミット完了', {
            processingCount: queueStatus.processingCount,
            pendingCount: queueStatus.pendingCount,
            speechDuration: speechDuration + 'ms',
            timestamp: now
        });

        // ✅ 重複コミット防止（500ms以内の重複を無視）
        if (this.isDuplicateCommit(now)) {
            return;
        }

        // ✅ P1: 最小発話時長チェック（1秒未満は500ms待って確認）
        if (this.shouldWaitForSpeechConfirmation(speechDuration)) {
            return;
        }

        this.lastCommitTime = now;
        this.speechStartTime = null; // リセット

        // ✅ Phase 3: バッファから音声データ抽出
        this.isBufferingAudio = false; // バッファリング停止

        const { totalLength, sampleRate, actualDuration, combinedAudio } =
            this.extractAudioBuffer();

        // ✅ 早期検証: 音声が無い場合はスキップ
        if (!this.isValidAudioDuration(totalLength, actualDuration)) {
            return;
        }

        // ✅ 音声結合ロジック: 短い音声を結合して500ms以上にする
        const MIN_QUEUE_DURATION = 500; // ✅ 300ms → 500ms に変更（音声結巴を防ぐ）
        let finalAudio = combinedAudio;
        let finalDuration = actualDuration;

        if (actualDuration < MIN_QUEUE_DURATION) {
            // ✅ 500ms未満の音声は保留バッファに追加
            this.addToPendingBuffer(combinedAudio, actualDuration);
            return; // 保留中、次の音声を待つ
        }

        // ✅ 1秒以上の音声: 保留中の音声がある場合は結合
        if (this.pendingAudioBuffer) {
            console.info('[Audio Combine] 保留音声と結合して送信:', {
                pendingDuration: this.pendingAudioDuration + 'ms',
                currentDuration: actualDuration + 'ms',
                totalDuration: this.pendingAudioDuration + actualDuration + 'ms'
            });

            const combined = new Float32Array(
                this.pendingAudioBuffer.length + combinedAudio.length
            );
            combined.set(this.pendingAudioBuffer, 0);
            combined.set(combinedAudio, this.pendingAudioBuffer.length);
            finalAudio = combined;
            finalDuration = this.pendingAudioDuration + actualDuration;

            // バッファをクリア
            this.clearPendingBuffer();
        }

        // ✅ Phase 3: 新アーキテクチャ有効化
        const ENABLE_AUDIO_QUEUE = true; // ← 新アーキテクチャ有効化

        if (ENABLE_AUDIO_QUEUE) {
            if (this.tryEnqueueAudioSegment(finalAudio, finalDuration, sampleRate, now)) {
                return; // ← 新アーキテクチャ使用、旧ロジック非実行
            }
        }

        // ✅ 旧ロジック（フォールバック）
        this.processFallbackAudioRequest(queueStatus);
    },

    /**
     * 重複コミットをチェック（800ms以内の重複を無視）
     * @param {number} now - 現在のタイムスタンプ
     * @returns {boolean} 重複コミットの場合は true
     */
    isDuplicateCommit(now) {
        if (now - this.lastCommitTime < 800) {
            // ✅ 500ms → 800ms に変更（音声結巴を防ぐ）
            console.warn('[Audio] 重複コミットを検出、スキップします', {
                timeSinceLastCommit: now - this.lastCommitTime
            });
            return true;
        }
        return false;
    },

    /**
     * 発話時長確認待機が必要かチェック
     * @param {number} speechDuration - 発話時長（ms）
     * @returns {boolean} 確認待機が必要な場合は true
     */
    shouldWaitForSpeechConfirmation(speechDuration) {
        if (speechDuration > 0 && speechDuration < this.minSpeechDuration) {
            console.warn('[VAD Buffer] 発話時長が短い、確認待機中...', {
                duration: speechDuration + 'ms',
                minDuration: this.minSpeechDuration + 'ms',
                willConfirmIn: this.silenceConfirmDelay + 'ms'
            });

            // 既存のタイマーをクリア
            if (this.silenceConfirmTimer) {
                clearTimeout(this.silenceConfirmTimer);
            }

            // 500ms後に再確認
            this.silenceConfirmTimer = setTimeout(() => {
                this.confirmSpeechDuration();
            }, this.silenceConfirmDelay);

            return true;
        }
        return false;
    },

    /**
     * 発話時長を確認し、必要に応じて処理を再開
     */
    confirmSpeechDuration() {
        // ✅ 防御: speechStartTime が null の場合は処理しない
        if (!this.speechStartTime) {
            console.warn('[VAD Buffer] speechStartTime が null、スキップ');
            this.silenceConfirmTimer = null;
            return;
        }

        const finalDuration = Date.now() - this.speechStartTime;
        if (finalDuration >= this.minSpeechDuration) {
            console.info('[VAD Buffer] 確認完了: 発話時長OK', {
                duration: finalDuration + 'ms'
            });
            // 再帰呼び出し（但し今回は時長チェックをパスする）
            this.speechStartTime = null; // リセットしてチェックをスキップ
            this.handleAudioBufferCommitted();
        } else {
            console.warn('[VAD Buffer] 発話時長が短すぎる、スキップ', {
                duration: finalDuration + 'ms',
                minRequired: this.minSpeechDuration + 'ms'
            });
        }
        this.silenceConfirmTimer = null;
    },

    /**
     * 音声バッファから音声データを抽出
     * @returns {Object} { totalLength, sampleRate, actualDuration, combinedAudio }
     */
    extractAudioBuffer() {
        // バッファ内全音声チャンク結合
        let totalLength = 0;
        for (const chunk of this.audioBuffer) {
            totalLength += chunk.length;
        }

        // ✅ 重要: actualDuration を先に計算してからバッファをクリア
        // これにより 0.00ms の問題を防ぐ
        const sampleRate = this.state.audioContext?.sampleRate || 24000;
        const actualDuration = (totalLength / sampleRate) * 1000;

        console.info('[Audio] 音声データ抽出完了:', {
            samples: totalLength,
            duration: actualDuration.toFixed(2) + 'ms',
            bufferChunks: this.audioBuffer.length,
            sampleRate: sampleRate + 'Hz'
        });

        // ✅ ここまで来たら音声は有効、バッファをクリア
        const combinedAudio = new Float32Array(totalLength);
        let offset = 0;
        for (const chunk of this.audioBuffer) {
            combinedAudio.set(chunk, offset);
            offset += chunk.length;
        }
        this.audioBuffer = [];

        return { totalLength, sampleRate, actualDuration, combinedAudio };
    },

    /**
     * 音声時長が有効かチェック
     * @param {number} totalLength - サンプル数
     * @param {number} actualDuration - 音声時長（ms）
     * @returns {boolean} 有効な場合は false、無効な場合は true（スキップ）
     */
    isValidAudioDuration(totalLength, actualDuration) {
        // ✅ 早期検証: 音声が無い場合はスキップ
        if (totalLength === 0 || actualDuration < 100) {
            // 100ms 未満は無視
            console.warn('[Audio] 音声データが不足、スキップ:', {
                samples: totalLength,
                duration: actualDuration.toFixed(2) + 'ms'
            });
            return true;
        }

        // ✅ 修正: 最小音声時長を 300ms に設定（品質優先）
        // 理由: 短い単語や文の前半部分も重要（例: "Yes", "OK", "I think..."）
        //       300ms未満は明らかなノイズ・クリック音のみスキップ
        if (actualDuration < 300) {
            console.info('[Audio] 音声が短すぎる、スキップ:', {
                duration: actualDuration.toFixed(2) + 'ms',
                minRequired: '300ms',
                reason: '300ms未満はノイズの可能性が高い'
            });
            return true; // ✅ スキップ（キューに入れない）
        }

        return false;
    },

    /**
     * 保留バッファをクリア
     */
    clearPendingBuffer() {
        this.pendingAudioBuffer = null;
        this.pendingAudioDuration = 0;
        if (this.pendingAudioTimer) {
            clearTimeout(this.pendingAudioTimer);
            this.pendingAudioTimer = null;
        }
    },

    /**
     * 保留バッファに音声を追加
     * @param {Float32Array} audioData - 音声データ
     * @param {number} duration - 音声時長（ms）
     */
    addToPendingBuffer(audioData, duration) {
        if (!this.pendingAudioBuffer) {
            // 初回: 新しいバッファを作成
            this.pendingAudioBuffer = audioData;
            this.pendingAudioDuration = duration;
            console.info('[Audio Combine] 音声を保留バッファに追加（初回）:', {
                duration: duration + 'ms',
                samples: audioData.length
            });
        } else {
            // 2回目以降: 既存のバッファと結合
            const combined = new Float32Array(this.pendingAudioBuffer.length + audioData.length);
            combined.set(this.pendingAudioBuffer, 0);
            combined.set(audioData, this.pendingAudioBuffer.length);
            this.pendingAudioBuffer = combined;
            this.pendingAudioDuration += duration;
            console.info('[Audio Combine] 音声を保留バッファに追加（結合）:', {
                previousDuration: this.pendingAudioDuration - duration + 'ms',
                addedDuration: duration + 'ms',
                totalDuration: this.pendingAudioDuration + 'ms',
                totalSamples: combined.length
            });
        }

        // ✅ タイムアウトタイマーをリセット
        if (this.pendingAudioTimer) {
            clearTimeout(this.pendingAudioTimer);
        }

        // ✅ 1秒後に強制送信（次の音声が来ない場合）
        this.pendingAudioTimer = setTimeout(() => {
            if (!this.pendingAudioBuffer) {
                return;
            }

            console.info('[Audio Combine] タイムアウト - 保留音声を強制送信:', {
                duration: this.pendingAudioDuration + 'ms'
            });

            // ✅ 修正: 保留バッファを直接キューに送信（handleAudioBufferCommitted を再帰呼び出ししない）
            const bufferedAudio = this.pendingAudioBuffer;
            const bufferedDuration = this.pendingAudioDuration;

            // バッファをクリア（無限ループ防止）
            this.clearPendingBuffer();

            // ✅ 直接キューに追加
            const sampleRate = this.state.audioContext?.sampleRate || 24000;
            this.tryEnqueueAudioSegment(bufferedAudio, bufferedDuration, sampleRate, Date.now());
        }, this.pendingAudioTimeout);

        // ✅ 保留バッファが300ms以上になったら即座に送信
        if (this.pendingAudioDuration >= 300) {
            console.info('[Audio Combine] 保留バッファが300ms以上 - 即座に送信:', {
                duration: this.pendingAudioDuration + 'ms'
            });
            clearTimeout(this.pendingAudioTimer);

            // ✅ 修正: 保留バッファを直接キューに送信（handleAudioBufferCommitted を再帰呼び出ししない）
            const bufferedAudio = this.pendingAudioBuffer;
            const bufferedDuration = this.pendingAudioDuration;

            // バッファをクリア（無限ループ防止）
            this.clearPendingBuffer();

            // ✅ 直接キューに追加
            const sampleRate = this.state.audioContext?.sampleRate || 24000;
            this.tryEnqueueAudioSegment(bufferedAudio, bufferedDuration, sampleRate, Date.now());
        }
    },

    /**
     * 音声セグメントをキューに追加
     * @param {Float32Array} combinedAudio - 結合された音声データ
     * @param {number} actualDuration - 音声時長（ms）
     * @param {number} sampleRate - サンプルレート
     * @param {number} now - 現在のタイムスタンプ
     * @returns {boolean} 成功した場合は true
     */
    tryEnqueueAudioSegment(combinedAudio, actualDuration, sampleRate, now) {
        // ✅ デバッグ：tryEnqueueAudioSegment 呼び出し確認
        console.warn('[Audio] ========== tryEnqueueAudioSegment 呼び出し ==========');
        console.warn('[Audio] combinedAudio.length:', combinedAudio?.length);
        console.warn('[Audio] actualDuration:', actualDuration + 'ms');
        console.warn('[Audio] sampleRate:', sampleRate);
        console.warn('[Audio] =======================================================');

        // ✅ 新アーキテクチャ有効化フラグを設定
        this.useAudioQueue = true;

        // ✅ 有効な音声データのみをキューに追加
        const segment = this.audioQueue.enqueue(combinedAudio, {
            duration: actualDuration,
            language: this.state.sourceLang,
            sourceType: this.state.audioSourceType,
            timestamp: now,
            sampleRate: sampleRate
        });

        if (!segment) {
            console.error('[Audio] AudioQueue への追加失敗（キューが満杯か短すぎる）');
            // 旧ロジックをフォールバックとして継続使用
            this.useAudioQueue = false; // ← フォールバック時は旧アーキテクチャを使用
            return false;
        }

        console.info('[Audio] AudioSegment 作成完了:', {
            segmentId: segment.id,
            duration: actualDuration.toFixed(2) + 'ms',
            samples: combinedAudio.length,
            queueSize: this.audioQueue.size()
        });
        // ✅ 双パス処理会通过 segmentReady イベント自动触発
        // 参见: handleNewAudioSegment()
        return true;
    },

    /**
     * フォールバック音声リクエスト処理
     * 修正内容（プル型アーキテクチャ）:
     *   - activeResponseId/pendingResponseId のチェックを削除
     *   - ResponseQueue が自動的に並発制御を行う
     *   - キューのpendingCountが多すぎる場合のみスキップ
     * @param {Object} queueStatus - キューのステータス
     */
    processFallbackAudioRequest(queueStatus) {
        // ✅ プル型アーキテクチャ: pendingResponseId のチェックを削除
        // 理由: ResponseQueue が自動的に並発制御を行うため不要
        //       response.done イベント後に自動的に次のリクエストを送信

        // ✅ キューの pending 数が多い場合はスキップ（バックアップ防止）
        if (queueStatus.pendingCount > 5) {
            console.warn('[Audio] キューの待機数が多いため、スキップします', {
                pendingCount: queueStatus.pendingCount,
                maxPending: 5
            });
            return;
        }

        this.enqueueResponseRequest(queueStatus);
    },

    /**
     * レスポンスリクエストをキューに追加
     * 修正内容（プル型アーキテクチャ）:
     *   - activeResponseId/pendingResponseId の管理を削除
     *   - ResponseQueue が自動的に並発制御を行う
     * @param {Object} queueStatus - キューのステータス
     */
    enqueueResponseRequest(queueStatus) {
        // ✅ プル型アーキテクチャ: pendingResponseId の管理を削除
        // 理由: ResponseQueue が自動的に並発制御を行うため不要

        const audioOutputEnabled = this.elements.audioOutputEnabled.classList.contains('active');
        // GA: output_modalities は ['audio'] または ['text']
        const outputModalities = audioOutputEnabled ? ['audio'] : ['text'];

        console.info('[🔊 Response Create] 要求:', {
            outputModalities: outputModalities,
            audioOutputEnabled: audioOutputEnabled,
            queueStatus: queueStatus
        });

        this.responseQueue
            .enqueue({
                output_modalities: outputModalities,
                instructions: this.getInstructions()
            })
            .then(() => {
                console.info('[Audio] レスポンスリクエストをキューに追加しました');
            })
            .catch((error) => {
                if (error.message.includes('Queue is full')) {
                    console.warn('[Audio] キューが満杯のため、リクエストをスキップしました');
                } else {
                    console.error('[Audio] レスポンスリクエスト失敗:', error);
                }
            });
    },

    /**
     * 発話開始イベント処理
     */
    handleSpeechStarted() {
        // ✅ P1: 記録発話開始時刻
        this.speechStartTime = Date.now();

        // ✅ Phase 3: 启動音声缓冲
        this.isBufferingAudio = true;
        this.audioBuffer = []; // バッファクリア
        this.audioBufferStartTime = Date.now();

        // ✅ 重置句子追踪
        this.currentTranscriptBuffer = '';
        this.sentenceCount = 0;

        console.info('[Speech] 音声検出開始', { startTime: this.speechStartTime });
        this.updateStatus('recording', '話し中...');
    },

    /**
     * 発話停止イベント処理
     */
    handleSpeechStopped() {
        const duration = this.speechStartTime ? Date.now() - this.speechStartTime : 0;
        console.info('[Speech] 音声検出停止', { duration: duration + 'ms' });
        this.updateStatus('recording', '処理中...');
        this.state.isNewResponse = true;
    },

    /**
     * 入力音声認識完了イベント処理
     */
    handleTranscriptionCompleted(message) {
        console.info('[Transcription] 入力音声認識完了:', message.transcript);
        if (message.transcript) {
            const transcriptId = Date.now();
            this.addTranscript('input', message.transcript, transcriptId);
            this.currentTranscriptId = transcriptId;

            // ✅ 句子数量追踪（実時性向上）
            this.updateTranscriptBuffer(message.transcript);
        }
    },

    /**
     * ✅ 更新転写文本缓冲区并检查是否达到目标句子数
     *
     * 目的：
     *   基于句子数量而不是时长来决定何时提交音频
     *   提高实时性，同时保证质量
     *
     * 策略：
     *   - 累積転写文本
     *   - 统计句子数量（通过标点符号）
     *   - 达到2-3句时，立即提交音频缓冲
     *   - 或超过最大时长（10秒）时，强制提交
     */
    updateTranscriptBuffer(transcript) {
        // 累積転写文本
        this.currentTranscriptBuffer += transcript;

        // 统计句子数量（中文、日文、英文标点）
        const sentenceEndings = /[。！？.!?]+/g;
        const matches = this.currentTranscriptBuffer.match(sentenceEndings);
        this.sentenceCount = matches ? matches.length : 0;

        console.info('[Transcript Buffer] 句子追踪:', {
            currentText: this.currentTranscriptBuffer.substring(0, 50) + '...',
            sentenceCount: this.sentenceCount,
            targetCount: this.targetSentenceCount,
            bufferDuration:
                this.isBufferingAudio && this.audioBufferStartTime
                    ? Date.now() - this.audioBufferStartTime + 'ms'
                    : 'N/A'
        });

        // ✅ 检查是否应该提交音频
        this.checkShouldCommitAudio();
    },

    /**
     * ✅ 检查是否应该提交音频缓冲
     *
     * 条件：
     *   1. 达到目标句子数（2-3句）
     *   2. 或超过最大缓冲时长（10秒）
     */
    checkShouldCommitAudio() {
        if (!this.isBufferingAudio || !this.audioBufferStartTime) {
            return; // 未在缓冲中
        }

        const bufferDuration = Date.now() - this.audioBufferStartTime;
        const shouldCommitBySentenceCount = this.sentenceCount >= this.targetSentenceCount;
        const shouldCommitByDuration = bufferDuration >= this.maxBufferDuration;

        if (shouldCommitBySentenceCount || shouldCommitByDuration) {
            console.warn('[Transcript Buffer] ========== 音声提交触发 ==========');
            console.warn(
                '[Transcript Buffer] 触发原因:',
                shouldCommitBySentenceCount
                    ? `句子数達成（${this.sentenceCount}句）`
                    : `時長超過（${bufferDuration}ms）`
            );
            console.warn('[Transcript Buffer] 累積文本:', this.currentTranscriptBuffer);
            console.warn('[Transcript Buffer] =============================================');

            // 手动触发音频提交
            this.manuallyCommitAudioBuffer();

            // 重置缓冲区
            this.currentTranscriptBuffer = '';
            this.sentenceCount = 0;
        }
    },

    /**
     * ✅ 手动提交音频缓冲
     *
     * 目的：
     *   当达到句子数量目标时，主动提交音频缓冲
     *   而不是等待Server VAD检测到静音
     */
    manuallyCommitAudioBuffer() {
        if (!this.isBufferingAudio || this.audioBuffer.length === 0) {
            console.warn('[Manual Commit] 无音声数据可提交');
            return;
        }

        console.info('[Manual Commit] 手动提交音声缓冲:', {
            bufferChunks: this.audioBuffer.length,
            sentenceCount: this.sentenceCount
        });

        // 停止缓冲
        this.isBufferingAudio = false;

        // 触发音频提交处理
        this.handleAudioBufferCommitted();

        // 立即重新开始缓冲（为下一段音频做准备）
        this.isBufferingAudio = true;
        this.audioBuffer = [];
        this.audioBufferStartTime = Date.now();
    },

    /**
     * 音声翻訳テキストデルタ処理
     *
     * @description
     * 旧アーキテクチャ用のハンドラー
     * 新アーキテクチャ（AudioQueue）では、Path2 が独自にテキストを処理するため、
     * このハンドラーは実行されない
     */
    handleAudioTranscriptDelta(message) {
        // ✅ 新アーキテクチャが有効な場合はスキップ
        if (this.useAudioQueue) {
            return;
        }

        if (message.delta) {
            this.currentTranslationText += message.delta;
        }
    },

    /**
     * 音声翻訳テキスト完了処理
     *
     * @description
     * 旧アーキテクチャ用のハンドラー
     * 新アーキテクチャ（AudioQueue）では、Path2 が独自にテキストを表示するため、
     * このハンドラーは実行されない
     */
    handleAudioTranscriptDone() {
        // ✅ 新アーキテクチャが有効な場合はスキップ
        if (this.useAudioQueue) {
            console.info(
                '[旧アーキテクチャ] handleAudioTranscriptDone スキップ（新アーキテクチャ有効）'
            );
            return;
        }

        console.info('[処理1-2] 🔊 音声翻訳テキスト完了:', this.currentTranslationText);

        if (this.currentTranslationText.trim()) {
            console.info('[音声翻訳] テキスト:', this.currentTranslationText.trim());
            const transcriptId = this.currentTranscriptId || Date.now();
            this.addTranscript('output', this.currentTranslationText.trim(), transcriptId);
            this.currentTranslationText = '';
            this.currentTranscriptId = null;
        }

        this.state.isNewResponse = true;
    },

    /**
     * 音声デルタ受信処理
     */
    handleAudioDelta(message) {
        console.info('[🔊 Audio Delta] 受信:', {
            hasDelta: !!message.delta,
            deltaLength: message.delta ? message.delta.length : 0,
            currentQueueSize: this.playbackQueue ? this.playbackQueue.length : 0
        });
        if (message.delta) {
            this.playAudioChunk(message.delta);
        }
    },

    /**
     * 音声データ受信完了処理
     */
    handleAudioDone() {
        console.info('[🔊 Audio Done] 音声データ受信完了:', {
            audioOutputEnabled: this.elements.audioOutputEnabled.classList.contains('active'),
            modalities: this.state.ws ? '確認必要' : 'WebSocket未接続'
        });
    },

    /**
     * レスポンス作成イベント処理
     */
    handleResponseCreated(message) {
        console.info('[Response] Created:', {
            responseId: message.response.id,
            timestamp: Date.now()
        });

        // ✅ 新しい翻訳開始時に古い音声をクリア（翻訳音声の中断を防ぐ）
        // 理由: 複数の翻訳リクエストが並行して処理される場合、
        //       古い翻訳音声が新しい翻訳音声と混在して再生されるのを防ぐ
        this.clearPlaybackQueue();

        // ✅ プル型アーキテクチャ: activeResponseId のみ記録（デバッグ用）
        this.activeResponseId = message.response.id;
        this.responseQueue.handleResponseCreated(message.response.id);
    },

    /**
     * レスポンス完了イベント処理
     */
    handleResponseDone(message) {
        console.info('[Response] Complete:', {
            responseId: message.response.id,
            activeId: this.activeResponseId,
            timestamp: Date.now()
        });
        // ✅ プル型アーキテクチャ: 状態をクリア
        this.activeResponseId = null;
        // ✅ ResponseQueue が自動的に次のリクエストを送信（consume()）
        this.responseQueue.handleResponseDone(message.response.id);
        this.updateStatus('recording', '待機中');
        this.updateAccuracy();
    },

    /**
     * WebSocketメッセージエラー処理
     */
    handleWSMessageError(message) {
        console.error('[Error]', message.error);

        const errorCode = message.error.code || '';
        if (errorCode === 'conversation_already_has_active_response') {
            console.warn('[Error] 前のレスポンスが処理中です。ResponseQueue がリトライします。', {
                activeResponseId: this.activeResponseId,
                pendingResponseId: this.pendingResponseId
            });
            // ✅ プル型アーキテクチャ: エラー時は状態をクリアしない
            // 理由: ResponseQueue が自動的にリトライするため、
            //       状態をクリアすると二重送信の原因になる
            // 注意: response.done イベントで正しくクリアされる
            this.responseQueue.handleError(new Error(message.error.message), errorCode);
        } else {
            // ✅ 他のエラーの場合は状態をクリア
            this.activeResponseId = null;
            this.pendingResponseId = null;
            this.responseQueue.handleError(new Error(message.error.message), errorCode);
            this.notify('エラー', message.error.message, 'error');
        }
    },

    /**
     * WebSocketエラー処理
     */
    handleWSError(error) {
        console.error('[WS Error] WebSocketエラーが発生:', error);
        console.error('[WS Error] エラー詳細:', {
            type: error.type,
            target: error.target,
            message: error.message,
            readyState: this.state.ws ? this.state.ws.readyState : 'なし'
        });

        this.notify('接続エラー', 'WebSocket接続でエラーが発生しました', 'error');
    },

    /**
     * 音声データ送信
     *
     * 目的:
     *   Float32音声データをPCM16に変換してWebSocket経由で送信
     *   ループバック防止とVADフィルタリングを実装
     *
     * 入力:
     *   audioData: Float32Array形式の音声データ
     */
    sendAudioData(audioData) {
        // 接続状態チェック
        if (!this.state.isConnected) {
            console.warn('[Audio] 未接続のため音声データを送信できません');
            return;
        }

        // 録音状態チェック
        if (!this.state.isRecording) {
            console.warn('[Audio] 録音停止中のため音声データを送信しません');
            return;
        }

        // ✅ ループバック防止: 翻訳音声の再キャプチャを防止
        //
        // 【重要】ループバック防止は全てここで統一的に処理
        // onaudioprocess では処理しない（二重チェックを避ける）
        //
        // モード別の処理:
        //   1. マイクモード:
        //      - 再生中: スキップ（翻訳音声がスピーカーから出ている）
        //      - 再生終了後 bufferWindow 内: スキップ（スピーカー→マイク伝播遅延を考慮）
        //      - bufferWindow 経過後: 処理再開
        //
        //   2. システム音声モード:
        //      - 再生中: スキップ（翻訳音声と入力音声の混在を防止）
        //      - 再生終了後: 即座に処理再開（ループバックは発生しない）

        const now = Date.now();
        const isPlayingAudio = this.state.isPlayingAudio;
        const isMicrophoneMode = this.state.audioSourceType !== 'system';

        // マイクモードの場合のみバッファウィンドウを適用
        let shouldSkip = isPlayingAudio; // 全モード: 再生中はスキップ

        if (isMicrophoneMode && !isPlayingAudio) {
            // マイクモード: 再生終了後もバッファウィンドウ内はスキップ
            const timeSincePlaybackEnd = this.audioSourceTracker.outputEndTime
                ? now - this.audioSourceTracker.outputEndTime
                : Infinity;
            const isWithinBufferWindow =
                timeSincePlaybackEnd < this.audioSourceTracker.bufferWindow;

            if (isWithinBufferWindow) {
                shouldSkip = true;
                console.info('[Audio] ループバック防止 (マイクモード): バッファウィンドウ内', {
                    timeSincePlaybackEnd: `${timeSincePlaybackEnd.toFixed(0)}ms`,
                    bufferWindow: this.audioSourceTracker.bufferWindow
                });
            }
        }

        if (shouldSkip) {
            console.info('[Audio] ループバック防止: 音声をスキップ', {
                isPlayingAudio,
                audioSourceType: this.state.audioSourceType,
                reason: isPlayingAudio ? '再生中' : 'バッファウィンドウ内'
            });
            return;
        }

        // Float32をPCM16に変換（即座に送信、節流なし）
        const pcmData = Utils.floatTo16BitPCM(audioData);
        const base64Audio = Utils.arrayBufferToBase64(pcmData);

        const message = {
            type: 'input_audio_buffer.append',
            audio: base64Audio
        };

        this.sendMessage(message);
    },

    /**
     * ✅ ストリーミング再生: 音声チャンクを即座に再生
     *
     * 目的:
     *   Realtime API の低遅延ストリーミングの利点を活かすため、
     *   音声チャンクを受信したら即座にデコード・再生する
     *
     * @param {string} base64Audio - base64エンコードされた音声データ
     */
    async playAudioChunk(base64Audio) {
        try {
            // 再生キューに追加
            this.playbackQueue.push(base64Audio);

            console.info('[🔊 Streaming] チャンク受信:', {
                queueLength: this.playbackQueue.length,
                isPlayingFromQueue: this.isPlayingFromQueue
            });

            // 再生中でなければ再生開始
            if (!this.isPlayingFromQueue) {
                console.info('[🔊 Streaming] 再生開始');
                this.playNextInQueue();
            }
        } catch (error) {
            console.error('[🔊 Streaming] チャンク処理エラー:', error);
        }
    },

    /**
     * 再生キューから次の音声を再生
     *
     * 目的:
     *   再生キューに蓄積された音声を順番に再生
     *   前の音声が完全に再生終了してから次の音声を再生することで、
     *   連続した翻訳音声が途中で切断されるのを防ぐ
     *
     * 注意:
     *   この関数は await せず、非同期で再生を開始する
     *   再生完了時に playAudio() の onended から再度呼び出される
     */
    playNextInQueue() {
        // キューが空の場合
        if (this.playbackQueue.length === 0) {
            this.isPlayingFromQueue = false;

            // 入力音声を復元（すべての再生が完了）
            // 注意: inputAudioOutputEnabled は削除されたため、常に0（ミュート）
            if (this.state.inputGainNode) {
                this.state.inputGainNode.gain.value = 0;
                console.info('[Playback Queue] キューが空 - 入力音声はミュート状態を維持');
            }

            console.info('[Playback Queue] キューが空 - 再生終了');
            return;
        }

        // 再生中フラグをON
        this.isPlayingFromQueue = true;

        // キューから最初の音声を取り出す
        const audioData = this.playbackQueue.shift();

        console.info('[Playback Queue] 次の音声を再生:', {
            remainingInQueue: this.playbackQueue.length
        });

        // 音声を再生（await しない - 非同期で開始）
        this.playAudio(audioData).catch((error) => {
            console.error('[Playback Queue] 再生エラー:', error);
            // エラーが発生しても次の音声を再生
            this.playNextInQueue();
        });
    },

    /**
     * ✅ PCM16 データを WAV 形式に変換
     *
     * 目的:
     *   AudioContext.decodeAudioData が認識できる WAV 形式に変換
     *
     * @param {ArrayBuffer} pcm16Data - PCM16 データ
     * @param {number} sampleRate - サンプルレート
     * @returns {ArrayBuffer} WAV 形式のデータ
     */
    createWavFromPCM16(pcm16Data, sampleRate) {
        const numChannels = 1; // モノラル
        const bitsPerSample = 16;
        const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
        const blockAlign = (numChannels * bitsPerSample) / 8;
        const dataSize = pcm16Data.byteLength;
        const headerSize = 44;
        const totalSize = headerSize + dataSize;

        const buffer = new ArrayBuffer(totalSize);
        const view = new DataView(buffer);

        // RIFF チャンク
        this.writeString(view, 0, 'RIFF');
        view.setUint32(4, totalSize - 8, true);
        this.writeString(view, 8, 'WAVE');

        // fmt チャンク
        this.writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true); // fmt チャンクサイズ
        view.setUint16(20, 1, true); // PCM フォーマット
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, byteRate, true);
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, bitsPerSample, true);

        // data チャンク
        this.writeString(view, 36, 'data');
        view.setUint32(40, dataSize, true);

        // PCM データをコピー
        const pcm16View = new Uint8Array(pcm16Data);
        const wavView = new Uint8Array(buffer);
        wavView.set(pcm16View, headerSize);

        return buffer;
    },

    /**
     * DataView に文字列を書き込む
     *
     * @param {DataView} view - DataView
     * @param {number} offset - オフセット
     * @param {string} string - 文字列
     */
    writeString(view, offset, string) {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    },

    /**
     * 音声再生の初期化処理
     *
     * 目的:
     *   出力AudioContextの作成とリジューム
     *
     * Returns:
     *   Promise<void>
     *
     * 注意:
     *   ネストを減らすため別メソッドに抽出
     */
    async initializeOutputAudioContext() {
        // 出力専用AudioContextが存在しない場合は作成
        // 入力処理と分離することで、出力音声の優先度を確保
        if (!this.state.outputAudioContext) {
            this.state.outputAudioContext = new (
                globalThis.AudioContext || globalThis.webkitAudioContext
            )({
                sampleRate: CONFIG.AUDIO.SAMPLE_RATE
            });
            console.info('[Audio] 出力専用AudioContextを作成しました');
            // 選択済みの出力先（原声分離用の物理デバイス）を適用
            await this.applyOutputSink();
        }

        // AudioContextがsuspended状態の場合はresume
        if (this.state.outputAudioContext.state === 'suspended') {
            await this.state.outputAudioContext.resume();
            console.info('[Audio] AudioContextをresumeしました');
        }
    },

    /**
     * 音声データのデコードと再生準備
     *
     * 目的:
     *   Base64音声データをデコードしてAudioBufferSourceを作成
     *
     * Parameters:
     *   base64Audio - Base64エンコードされた音声データ
     *
     * Returns:
     *   AudioBufferSource - 再生準備完了のAudioBufferSource
     *
     * 注意:
     *   ネストを減らすため別メソッドに抽出
     */
    async prepareAudioSource(base64Audio) {
        // Base64からArrayBufferに変換
        const pcm16Data = Utils.base64ToArrayBuffer(base64Audio);

        // PCM16 を WAV 形式に変換（decodeAudioData が必要とする形式）
        const wavData = this.createWavFromPCM16(pcm16Data, CONFIG.AUDIO.SAMPLE_RATE);

        // 非同期デコード
        const audioBuffer = await this.state.outputAudioContext.decodeAudioData(wavData);

        // 音量調整用のGainNodeを作成
        const gainNode = this.state.outputAudioContext.createGain();
        // 音量を設定（Electronアプリでの音量不足を解消）
        gainNode.gain.value = this.state.outputVolume;

        // 再生
        const source = this.state.outputAudioContext.createBufferSource();
        source.buffer = audioBuffer;

        // 音声チェーン: source → gainNode → destination
        source.connect(gainNode);
        gainNode.connect(this.state.outputAudioContext.destination);

        // ✅ メモリリーク修正: ノードの参照を保持して後でクリーンアップ
        return { source, gainNode };
    },

    /**
     * 音声再生完了時の処理
     *
     * 目的:
     *   再生終了後のフラグ更新とキュー処理
     *
     * Returns:
     *   void
     *
     * 注意:
     *   このメソッドはonendedコールバックから呼び出される
     */
    handleAudioPlaybackEnded() {
        // 即座に次の音声を再生（連続性最優先）
        this.state.isPlayingAudio = false;

        // 次の音声を再生（キューに残っている場合）
        // 注意: 入力音声の復元は playNextInQueue() で統一処理
        this.playNextInQueue();
    },

    /**
     * 音声再生エラー時の処理
     *
     * 目的:
     *   エラー発生時のフラグ更新と入力音声復元
     *
     * Parameters:
     *   error - エラーオブジェクト
     *
     * Returns:
     *   void
     *
     * 注意:
     *   ネストを減らすため別メソッドに抽出
     */
    handleAudioPlaybackError(error) {
        console.error('[Audio Play Error]', error);
        this.notify('音声再生エラー', error.message, 'error');

        // エラー時もフラグをOFF（すべてのモードで適用）
        this.state.isPlayingAudio = false;

        // 入力音声を復元
        if (this.state.inputGainNode) {
            this.state.inputGainNode.gain.value = this.state.inputAudioOutputEnabled ? 1 : 0;
            console.info('[Audio] エラー時 - 入力音声を復元');
        }

        // エラーでも次の音声を再生（キューを停止しない）
        this.playNextInQueue();
    },

    /**
     * 音声再生処理
     *
     * 目的:
     *   Base64エンコードされた音声データをデコードして再生
     *   ループバック防止と入力音声ミュート制御を実装
     *
     * @param {string} base64Audio - Base64エンコードされた音声データ
     */
    async playAudio(base64Audio) {
        // ✅ 音声源トラッキング開始: 出力再生時刻を記録
        const playbackToken =
            'playback_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        this.audioSourceTracker.playbackTokens.add(playbackToken);
        this.audioSourceTracker.outputStartTime = Date.now();

        // 音声再生中フラグをON（ループバック防止）
        // すべてのモード（マイク/ブラウザ音声/画面共有）で有効
        this.state.isPlayingAudio = true;

        // 出力音声再生中は入力音声を完全ミュート（優先度確保）
        if (this.state.inputGainNode) {
            this.state.inputGainNode.gain.value = 0;
            console.info('[Audio] 出力再生中 - 入力音声を完全ミュート', {
                playbackToken,
                timestamp: this.audioSourceTracker.outputStartTime
            });
        }

        try {
            // 出力AudioContextの初期化
            await this.initializeOutputAudioContext();

            // ✅ 非同期デコード: AudioContext.decodeAudioData を使用
            // 理由: メインスレッドのブロックを防ぎ、UI の応答性を維持
            const { source, gainNode } = await this.prepareAudioSource(base64Audio);

            // 再生終了時にフラグをOFF（すべてのモードで適用）
            source.onended = () => {
                // ✅ メモリリーク修正: ノードを切断してクリーンアップ
                try {
                    source.disconnect();
                    gainNode.disconnect();
                    console.info('[Audio] ノードをクリーンアップしました:', { playbackToken });
                } catch (cleanupError) {
                    console.warn('[Audio] ノードクリーンアップエラー:', cleanupError);
                }

                // ✅ 出力完了時刻を記録（バッファウィンドウの計算用）
                this.audioSourceTracker.outputEndTime = Date.now();
                this.audioSourceTracker.playbackTokens.delete(playbackToken);
                this.handleAudioPlaybackEnded();
            };

            console.info('[Audio] 音声再生開始:', {
                playbackToken,
                outputStartTime: this.audioSourceTracker.outputStartTime
            });

            source.start();
        } catch (error) {
            // ✅ エラー時もトークンをクリア
            this.audioSourceTracker.playbackTokens.delete(playbackToken);
            this.handleAudioPlaybackError(error);
            throw error;
        }
    },

    /**
     * ✅ 新しい音声セグメント処理（双パス並列処理）
     *
     * @description
     * 音声入力を起点として、2つの処理を並列実行：
     * 1. Path1（テキストパス）: 音声送信 → STT → テキスト翻訳（モード2のみ）
     * 2. Path2（音声パス）: 音声送信待機 → 音声翻訳 → 音声再生
     *
     * 重複防止メカニズム:
     *   - Path1: 音声をサーバーに送信 → markAudioSent() 呼び出し
     *   - Path2: waitForAudioSent() で Path1 の送信完了を待機
     *   - 両パスが完了したらセグメントを削除
     *
     * @param {AudioSegment} segment 音声セグメント
     */
    async handleNewAudioSegment(segment) {
        console.info('[Audio] 新しいセグメント処理開始:', {
            id: segment.id,
            queueSize: this.audioQueue.size(),
            duration: segment.getDuration() + 'ms'
        });

        // ✅ モード設定: 「リアルタイム音声翻訳」トグルの状態に基づいて設定
        // ON（true）: モード2（音声翻訳 + テキスト翻訳）
        // OFF（false）: モード2（テキスト翻訳のみ）- バグ修正: テキスト翻訳を実行
        const isRealtimeAudioMode = this.elements.translationModeAudio.classList.contains('active');
        const textPathMode = 2; // ✅ 常にテキスト翻訳を実行
        const voicePathMode = isRealtimeAudioMode ? 2 : 1; // ON: 音声翻訳も実行, OFF: 音声翻訳はスキップ

        this.textPathProcessor.setMode(textPathMode);
        this.voicePathProcessor.setMode(voicePathMode);

        console.info('[Audio] パス処理器モード設定:', {
            isRealtimeAudioMode: isRealtimeAudioMode,
            textPathMode: textPathMode,
            voicePathMode: voicePathMode,
            description: isRealtimeAudioMode
                ? '音声翻訳 + テキスト翻訳モード'
                : 'テキスト翻訳のみモード'
        });

        // ✅ パス1とパス2を並列実行（リアルタイム性向上）
        const startTime = Date.now();
        console.info('[Audio] 並列処理開始:', { segmentId: segment.id });

        // Promise.allSettled を使用して、一方のエラーが他方に影響しないようにする
        const results = await Promise.allSettled([
            this.textPathProcessor.process(segment),
            this.voicePathProcessor.process(segment)
        ]);

        const processingTime = Date.now() - startTime;

        // ✅ 各パスの結果を確認
        const [path1Result, path2Result] = results;

        console.info('[Audio] 並列処理完了:', {
            segmentId: segment.id,
            processingTime: processingTime + 'ms',
            path1Status: path1Result.status,
            path2Status: path2Result.status,
            path1Complete: segment.processingStatus.path1_text === 1,
            path2Complete: segment.processingStatus.path2_voice === 1
        });

        // ✅ エラーチェック（各パス内で既にエラーハンドリングされているが、念のため）
        if (path1Result.status === 'rejected') {
            console.error('[Audio] Path1 エラー:', {
                segmentId: segment.id,
                error: path1Result.reason
            });
            // Path1 が完了マークされていない場合のみマーク
            if (segment.processingStatus.path1_text === 0) {
                this.audioQueue.markPathComplete(segment.id, 'path1', {
                    error: path1Result.reason?.message || 'Unknown error'
                });
            }
        }

        if (path2Result.status === 'rejected') {
            console.error('[Audio] Path2 エラー:', {
                segmentId: segment.id,
                error: path2Result.reason
            });
            // Path2 が完了マークされていない場合のみマーク
            if (segment.processingStatus.path2_voice === 0) {
                this.audioQueue.markPathComplete(segment.id, 'path2', {
                    error: path2Result.reason?.message || 'Unknown error'
                });
            }
        }

        console.info('[Audio] セグメント処理完全完了:', {
            segmentId: segment.id,
            totalDuration: segment.getAge() + 'ms',
            processingTime: processingTime + 'ms'
        });
    },

    /**
     * ✅ 音声セグメント完全処理完了
     *
     * @param {AudioSegment} segment 音声セグメント
     */
    handleSegmentComplete(segment) {
        console.info('[Audio] セグメント完全処理完了:', {
            id: segment.id,
            duration: segment.getDuration() + 'ms',
            age: segment.getAge() + 'ms',
            results: {
                path1: segment.results.path1 !== null ? 'OK' : 'N/A',
                path2: segment.results.path2 !== null ? 'OK' : 'N/A'
            }
        });

        // 統計情報更新
        const stats = this.audioQueue.getStats();
        console.info('[AudioQueue] 統計:', stats);

        // UI に統計情報を表示
        this.updateLatencyDisplay(stats);
        this.updateAccuracy();
    },

    /**
     * WebSocket接続終了処理
     *
     * 目的:
     *   WebSocket接続が閉じられた時の処理
     *
     * 入力:
     *   event: CloseEventオブジェクト（またはコード番号）
     *
     * 注意:
     *   正常終了と異常終了を区別して処理
     */
    handleWSClose(event) {
        console.info('[WS] Closed - WebSocket接続が閉じました');

        // イベントオブジェクトの安全な取得
        const code = event?.code || event || 1005;
        const reason = event?.reason || '';
        const wasClean = event?.wasClean !== undefined ? event.wasClean : true;

        console.info('[WS Close] 詳細:', {
            code: code,
            reason: reason,
            wasClean: wasClean
        });

        // エラーコード詳細
        let errorDetail = '';
        let isNormalClose = false; // 正常切断かどうか

        switch (code) {
            case 1000:
                errorDetail = '正常終了';
                isNormalClose = true;
                break;
            case 1001:
                errorDetail = 'エンドポイント離脱';
                isNormalClose = true;
                break;
            case 1002:
                errorDetail = 'プロトコルエラー';
                break;
            case 1003:
                errorDetail = '未対応データ';
                break;
            case 1005:
                errorDetail = '正常切断（理由なし）';
                isNormalClose = true;
                break;
            case 1006:
                errorDetail = '異常終了（接続失敗の可能性）';
                break;
            case 1007:
                errorDetail = '不正なデータ';
                break;
            case 1008:
                errorDetail = 'ポリシー違反';
                break;
            case 1009:
                errorDetail = 'メッセージが大きすぎる';
                break;
            case 1011:
                errorDetail = 'サーバーエラー';
                break;
            case 4000:
                errorDetail = 'OpenAI API認証エラー';
                break;
            default:
                errorDetail = `不明なエラー (コード: ${code})`;
        }

        // 正常切断の場合はinfoログ、異常終了の場合はerrorログ
        if (isNormalClose) {
            console.info('[WS Close] 接続終了:', errorDetail);
            // 正常切断の場合は通知を表示しない
        } else {
            console.error('[WS Close] エラー詳細:', errorDetail);
            this.notify('接続終了', errorDetail, 'warning');
        }

        // 自動再接続: ユーザーが「開始」状態かつ終了中でなく、異常切断なら背景で再接続する。
        // 認証エラー(4000)は再接続しても解決しないため除外する。
        const isAuthError = code === 4000;
        if (
            this.state.userWantsActive &&
            !this.state.isUnloading &&
            !isNormalClose &&
            !isAuthError
        ) {
            console.warn('[WS Close] 異常切断 → 自動再接続をスケジュールします');
            this.state.isConnected = false;
            this.state.ws = null;
            // ローカルの録音/音声処理のみ停止（「開始」意図は維持して resume する）
            this.stopRecording();
            this.updateConnectionStatus('connecting');
            this.scheduleReconnect();
            return;
        }

        // 認証エラーや「停止」意図のときは再接続しない
        if (isAuthError) {
            this.state.userWantsActive = false;
        }
        this.disconnect();
    }
};

// voicetranslate-pro.js で使用されるため、エクスポート
const _WebSocketMixin = WebSocketMixin;
