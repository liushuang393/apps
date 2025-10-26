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
        const isElectron =
            typeof globalThis.window !== 'undefined' && globalThis.window.electronAPI;

        if (isElectron) {
            // Electron環境
            const result = await globalThis.window.electronAPI.realtimeWebSocketSend(
                JSON.stringify(message)
            );
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
            case 'response.audio_transcript.delta':
                this.handleAudioTranscriptDelta(message);
                break;
            case 'response.audio_transcript.done':
                this.handleAudioTranscriptDone();
                break;
            case 'response.audio.delta':
                this.handleAudioDelta(message);
                break;
            case 'response.audio.done':
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
            activeResponseId: this.activeResponseId,
            pendingResponseId: this.pendingResponseId,
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

        // ✅ Phase 3: 新アーキテクチャ有効化
        const ENABLE_AUDIO_QUEUE = true; // ← 新アーキテクチャ有効化

        if (ENABLE_AUDIO_QUEUE) {
            if (this.tryEnqueueAudioSegment(combinedAudio, actualDuration, sampleRate, now)) {
                return; // ← 新アーキテクチャ使用、旧ロジック非実行
            }
        }

        // ✅ 旧ロジック（フォールバック）
        this.processFallbackAudioRequest(queueStatus);
    },

    /**
     * 重複コミットをチェック（500ms以内の重複を無視）
     * @param {number} now - 現在のタイムスタンプ
     * @returns {boolean} 重複コミットの場合は true
     */
    isDuplicateCommit(now) {
        if (now - this.lastCommitTime < 500) {
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

        // ✅ 修正: 最小音声時長を 500ms に引き下げ（通訳では短発話も重要）
        // OpenAI Realtime API は 100ms 以上あれば処理可能
        if (actualDuration < 500) {
            console.info('[Audio] 短い音声ですが処理します:', {
                duration: actualDuration.toFixed(2) + 'ms',
                minRequired: '500ms',
                reason: '同時通訳では短い発話も重要（例：返答、相槌）'
            });
            // 修正前は return true（スキップ）、修正後は続行
        }

        return false;
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
     * 修正内容:
     *   - activeResponseId をチェックしない（キューが並発リクエストを管理）
     *   - pendingResponseId のみチェック（送信中の重複を防ぐ）
     *   - キューのpendingCountが多すぎる場合もスキップ
     * @param {Object} queueStatus - キューのステータス
     */
    processFallbackAudioRequest(queueStatus) {
        // ✅ 修正: pendingResponseId のみチェック（送信中のリクエスト重複を防ぐ）
        // activeResponseId は不要（キューが処理中のレスポンスを管理）
        if (this.pendingResponseId) {
            console.warn('[Audio] 前のリクエスト送信中のため、新しいリクエストをスキップします', {
                pendingResponseId: this.pendingResponseId,
                queueStatus: queueStatus
            });
            return;
        }

        // ✅ キューの pending 数が多い場合はスキップ（バックアップ防止）
        if (queueStatus.pendingCount > 5) {
            console.warn('[Audio] キューの待機数が多いため、スキップします', {
                pendingCount: queueStatus.pendingCount,
                maxPending: 5
            });
            return;
        }

        // ✅ 重要: enqueueResponseRequest を呼ぶ前に pendingResponseId を設定
        this.pendingResponseId = 'pending_' + Date.now();

        this.enqueueResponseRequest(queueStatus);
    },

    /**
     * レスポンスリクエストをキューに追加
     * 修正内容:
     *   - activeResponseId チェックを削除（キューが管理）
     *   - pendingResponseId のみで重複防止
     * @param {Object} queueStatus - キューのステータス
     */
    enqueueResponseRequest(queueStatus) {
        // ✅ 修正: activeResponseId のチェックを削除
        // （キューが処理中のレスポンスを管理するため不要）
        // ✅ pendingResponseId が未設定の場合のみ設定（handleAudioBufferCommitted で設定済みの場合は保持）
        if (!this.pendingResponseId) {
            this.pendingResponseId = 'pending_' + Date.now();
        }

        const audioOutputEnabled = this.elements.audioOutputEnabled.classList.contains('active');
        const modalities = audioOutputEnabled ? ['text', 'audio'] : ['text'];

        console.info('[🔊 Response Create] 要求:', {
            modalities: modalities,
            audioOutputEnabled: audioOutputEnabled,
            queueStatus: queueStatus,
            pendingResponseId: this.pendingResponseId
        });

        this.responseQueue
            .enqueue({
                modalities: modalities,
                instructions: this.getInstructions()
            })
            .then(() => {
                console.info('[Audio] レスポンスリクエストをキューに追加しました');
            })
            .catch((error) => {
                // ✅ エラー時は pendingResponseId をクリア
                this.pendingResponseId = null;

                if (error.message.includes('Previous response is still in progress')) {
                    console.info(
                        '[Audio] 前のレスポンス処理中のため、リクエストをスキップしました'
                    );
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
        }
    },

    /**
     * 音声翻訳テキストデルタ処理
     */
    handleAudioTranscriptDelta(message) {
        if (message.delta) {
            this.currentTranslationText += message.delta;
        }
    },

    /**
     * 音声翻訳テキスト完了処理
     */
    handleAudioTranscriptDone() {
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
            previousActiveId: this.activeResponseId,
            previousPendingId: this.pendingResponseId,
            timestamp: Date.now()
        });
        // ✅ 仮IDを実際のレスポンスIDで上書き
        this.activeResponseId = message.response.id;
        this.pendingResponseId = null; // ✅ リクエスト送信完了、ペンディング状態をクリア
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
        this.activeResponseId = null;
        this.pendingResponseId = null; // ✅ レスポンス完了、ペンディング状態もクリア
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
            console.warn('[Error] 前のレスポンスが処理中です。状態をリセットします。', {
                activeResponseId: this.activeResponseId,
                pendingResponseId: this.pendingResponseId
            });
            // ✅ エラー時は両方の状態をクリア
            // サーバー側に既に active response があるため、クライアント側の temp_xxx ID はクリア
            // 実際の response.done イベントで正しくクリアされる
            if (this.activeResponseId && this.activeResponseId.startsWith('temp_')) {
                // temp ID の場合はクリア（サーバー側には到達していない）
                this.activeResponseId = null;
            }
            // pending ID は必ずクリア
            this.pendingResponseId = null;
            this.responseQueue.handleError(new Error(message.error.message), errorCode);
        } else {
            // ✅ 他のエラーの場合も状態をクリア
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

        // ✅ ループバック防止: システム音声モードの場合のみ、再生中の入力をスキップ
        // 理由:
        //   - マイクモード: ユーザーの音声と翻訳音声は別のソースなので、ループバックの心配がない
        //   - システム音声モード: 翻訳音声が再度入力として捕捉される可能性があるため、スキップが必要
        if (this.state.isPlayingAudio && this.state.audioSourceType === 'system') {
            return; // システム音声モードの場合のみスキップ
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
            if (this.state.inputGainNode) {
                this.state.inputGainNode.gain.value = this.state.inputAudioOutputEnabled ? 1 : 0;
                console.info(
                    '[Playback Queue] キューが空 - 入力音声を復元:',
                    this.state.inputAudioOutputEnabled ? 'ON' : 'OFF'
                );
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
            this.state.outputAudioContext = new (globalThis.AudioContext ||
                globalThis.webkitAudioContext)({
                sampleRate: CONFIG.AUDIO.SAMPLE_RATE
            });
            console.info('[Audio] 出力専用AudioContextを作成しました');
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

        return source;
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
            const source = await this.prepareAudioSource(base64Audio);

            // 再生終了時にフラグをOFF（すべてのモードで適用）
            source.onended = () => {
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
     * ✅ 新しい音声セグメント処理（双パス順次処理）
     *
     * @description
     * 音声入力を起点として、2つの処理を順番に実行：
     * 1. Path1（テキストパス）: 音声送信 → STT → テキスト翻訳（モード2のみ）
     * 2. Path2（音声パス）: 音声送信待機 → 音声翻訳 → 音声再生
     *
     * 排他制御により、1つのセグメントが完全に処理されるまで次のセグメントは開始されない
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
        // ON（true）: モード2（音声翻訳）→ テキスト翻訳も実行
        // OFF（false）: モード1（音声のみ）→ テキスト翻訳は実行しない
        const isRealtimeAudioMode = this.elements.translationModeAudio.classList.contains('active');
        const textPathMode = isRealtimeAudioMode ? 2 : 1;
        const voicePathMode = isRealtimeAudioMode ? 2 : 1;

        this.textPathProcessor.setMode(textPathMode);
        this.voicePathProcessor.setMode(voicePathMode);

        console.info('[Audio] パス処理器モード設定:', {
            isRealtimeAudioMode: isRealtimeAudioMode,
            textPathMode: textPathMode,
            voicePathMode: voicePathMode,
            description: isRealtimeAudioMode ? '音声翻訳モード' : 'テキスト翻訳モード'
        });

        try {
            // ✅ パス1: テキスト処理（順次実行）
            console.info('[Audio] Path1 開始:', { segmentId: segment.id });
            await this.textPathProcessor.process(segment);
            console.info('[Audio] Path1 完了:', { segmentId: segment.id });

            // ✅ パス2: 音声処理（順次実行）
            console.info('[Audio] Path2 開始:', { segmentId: segment.id });
            await this.voicePathProcessor.process(segment);
            console.info('[Audio] Path2 完了:', { segmentId: segment.id });

            console.info('[Audio] セグメント処理完全完了:', {
                segmentId: segment.id,
                totalDuration: segment.getAge() + 'ms'
            });
        } catch (error) {
            console.error('[Audio] セグメント処理エラー:', {
                segmentId: segment.id,
                error: error.message,
                stack: error.stack
            });

            // ✅ エラーでも両パスを完了マーク（次のセグメント処理を継続）
            if (segment.processingStatus.path1_text === 0) {
                this.audioQueue.markPathComplete(segment.id, 'path1', {
                    error: error.message
                });
            }
            if (segment.processingStatus.path2_voice === 0) {
                this.audioQueue.markPathComplete(segment.id, 'path2', {
                    error: error.message
                });
            }
        }
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

        this.disconnect();
    }
};

// voicetranslate-pro.js で使用されるため、エクスポート
const _WebSocketMixin = WebSocketMixin;
