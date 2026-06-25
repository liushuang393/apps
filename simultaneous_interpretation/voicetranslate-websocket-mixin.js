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

const REALTIME_MIN_COMMIT_AUDIO_MS = 100;

// 翻訳セッションの字幕確定ポリシー:
// デルタが途切れてから本時間(ms)を超えたら、句末標点が無くても確定表示する。
// 左カラムの原文STTは句末標点が来ないことが多く、これが無いと累積したまま表示されない。
const TRANSLATION_CAPTION_IDLE_MS = 1500;

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
            }
        } else if (this.usesWebRtcTransport()) {
            // ブラウザ/拡張機能の翻訳エンドポイント（WebRTC データチャネル）
            const dc = this.state.dataChannel;
            if (dc && dc.readyState === 'open') {
                dc.send(JSON.stringify(message));
            }
        } else if (this.state.ws && this.state.ws.readyState === WebSocket.OPEN) {
            // ブラウザ環境
            this.state.ws.send(JSON.stringify(message));
        }
    },

    getRealtimeInputAudioSampleRate() {
        if (typeof CONFIG !== 'undefined' && CONFIG.AUDIO && CONFIG.AUDIO.SAMPLE_RATE) {
            return CONFIG.AUDIO.SAMPLE_RATE;
        }
        return this.state.audioContext?.sampleRate || 24000;
    },

    getRealtimeInputAudioBufferStats() {
        if (!this.realtimeInputAudioBufferStats) {
            this.realtimeInputAudioBufferStats = {
                samples: 0,
                chunks: 0,
                updatedAt: 0
            };
        }

        const sampleRate = this.getRealtimeInputAudioSampleRate();
        return {
            ...this.realtimeInputAudioBufferStats,
            sampleRate,
            durationMs: (this.realtimeInputAudioBufferStats.samples / sampleRate) * 1000
        };
    },

    resetRealtimeInputAudioBufferStats() {
        this.realtimeInputAudioBufferStats = {
            samples: 0,
            chunks: 0,
            updatedAt: 0
        };
    },

    recordRealtimeInputAudioAppend(audioData) {
        const samples = audioData?.length || 0;
        if (samples <= 0) {
            return;
        }

        const stats = this.getRealtimeInputAudioBufferStats();
        this.realtimeInputAudioBufferStats = {
            samples: stats.samples + samples,
            chunks: stats.chunks + 1,
            updatedAt: Date.now()
        };
    },

    clearRealtimeInputAudioBuffer(reason = 'manual-clear') {
        this.sendMessage({ type: 'input_audio_buffer.clear' });
        this.resetRealtimeInputAudioBufferStats();
    },

    commitRealtimeInputAudioBuffer(reason = 'manual-commit') {
        // 翻訳セッションは音声を連続ストリームで処理するため手動 commit を行わない。
        // （commit すると per-turn のレスポンス生成を促してしまい、翻訳の連続性を壊す）
        return false;
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

            // メッセージタイプに応じたハンドラーを呼び出す
            this.dispatchWSMessage(message);
            this.notifyRealtimeMessageListeners(message);
        } catch (error) {
            // ホットパス（音声デルタ含む）のため通知はセッション中1度だけに抑制（多重トースト防止）
            if (!this._realtimeMsgErrorNotified) {
                this._realtimeMsgErrorNotified = true;
                this.notify('エラー', `メッセージ処理に失敗しました: ${error.message}`, 'error');
            }
        }
    },

    /**
     * Path1/Path2 が Realtime message stream を購読するための共通入口。
     * Browser/extension は WebSocket 直結、Electron は IPC 転送だが、処理器は同じ API で受け取る。
     *
     * @param {Function} listener
     */
    addRealtimeMessageListener(listener) {
        if (!this.realtimeMessageListeners) {
            this.realtimeMessageListeners = new Set();
        }
        this.realtimeMessageListeners.add(listener);
    },

    /**
     * @param {Function} listener
     */
    removeRealtimeMessageListener(listener) {
        if (this.realtimeMessageListeners) {
            this.realtimeMessageListeners.delete(listener);
        }
    },

    /**
     * パース済み message オブジェクトをそのまま購読者へ渡す。
     * 旧実装の JSON.stringify→各 listener で JSON.parse を廃止し、
     * 巨大な base64 audio delta を含むホットパスの二重シリアライズを排除する。
     *
     * @param {Object} message
     */
    notifyRealtimeMessageListeners(message) {
        if (!this.realtimeMessageListeners || this.realtimeMessageListeners.size === 0) {
            return;
        }

        for (const listener of Array.from(this.realtimeMessageListeners)) {
            try {
                listener(message);
            } catch (error) {
                // 1つのリスナー例外で他を止めない（分離）。診断のためセッション中初回のみ通知
                if (!this._realtimeMsgErrorNotified) {
                    this._realtimeMsgErrorNotified = true;
                    this.notify(
                        'エラー',
                        `リアルタイム処理でエラーが発生しました: ${error.message}`,
                        'error'
                    );
                }
            }
        }
    },

    /**
     * @returns {boolean}
     */
    isRealtimeTransportReady() {
        if (this.platform?.isElectron) {
            return !!this.state.isConnected;
        }
        if (this.usesWebRtcTransport()) {
            return !!(this.state.dataChannel && this.state.dataChannel.readyState === 'open');
        }
        return !!(this.state.ws && this.state.ws.readyState === WebSocket.OPEN);
    },

    isRealtimeTranslationSession() {
        const api = typeof CONFIG !== 'undefined' ? CONFIG.API || {} : {};
        const url = api.REALTIME_URL || '';
        const model = api.REALTIME_MODEL || '';
        return url.includes('/realtime/translations') || model === 'gpt-realtime-translate';
    },

    /**
     * 翻訳音声の出力先が採集源と分離されているか（回灌ループを物理的に断てる状態か）。
     *
     * 目的:
     *   システム音声モードで「再生中も連続採集（不漏訳）」を有効にしてよいかの安全判定。
     *   出力デバイスが明示選択（setSinkId 有効）されている場合のみ true。
     *   未選択（既定デバイス＝採集対象の可能性）や setSinkId 非対応環境は false とし、
     *   従来どおり再生中スキップして翻訳音声の再採集を防ぐ。
     *
     * @returns {boolean}
     */
    isOutputDeviceIsolated() {
        const ctx = this.state.outputAudioContext;
        return !!this.state.outputDeviceId && !!(ctx && typeof ctx.setSinkId === 'function');
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
            case 'conversation.item.input_audio_transcription.failed':
                this.handleTranscriptionFailed(message);
                break;
            // GA: response.audio_transcript.* → response.output_audio_transcript.*
            case 'response.output_audio_transcript.delta':
            case 'response.output_audio_transcript.done':
                // STS transcript text is rendered by VoicePathProcessor with response_id binding.
                break;
            // GA: response.audio.* → response.output_audio.*
            case 'response.output_audio.delta':
                this.handleAudioDelta(message);
                break;
            case 'response.output_audio.done':
                this.handleAudioDone(message);
                break;
            case 'response.created':
                this.handleResponseCreated(message);
                break;
            case 'response.done':
                this.handleResponseDone(message);
                break;
            // ▼ 翻訳専用セッション（/v1/realtime/translations）のストリームイベント
            case 'session.output_audio.delta':
                // 翻訳音声チャンク → 低遅延でそのまま再生（response_id バインド無し）
                // ※ WebRTC 経路では翻訳音声はリモートメディアトラックで再生されるため、
                //   ここで PCM 再生すると二重になる。WebRTC のときはスキップする。
                this.recordTranslationLatency('output');
                if (message.delta && !this.usesWebRtcTransport()) {
                    this.playAudioChunk(message.delta, { responseId: null, segmentId: null });
                }
                break;
            case 'session.output_transcript.delta':
                this.handleTranslationTranscriptDelta('output', message.delta);
                break;
            case 'session.input_transcript.delta':
                this.handleTranslationTranscriptDelta('input', message.delta);
                break;
            // セグメント終端イベントで確定する（句末標点に依存しない正規の境界）。
            // API のイベント名揺れに備えて .done / .completed の両方を受ける。
            case 'session.output_transcript.done':
            case 'session.output_transcript.completed':
                this.commitTranslationCaption('output');
                break;
            case 'session.input_transcript.done':
            case 'session.input_transcript.completed':
                this.commitTranslationCaption('input');
                break;
            case 'session.closed':
                // セッション終了時、句読点で確定されなかった末尾の字幕を取りこぼさず確定する。
                this.flushTranslationCaptions();
                break;
            case 'error':
                this.handleWSMessageError(message);
                break;
            default:
        }
    },

    /**
     * 翻訳専用セッションの transcript デルタを左右カラムへ累積表示する。
     * 文末（句点/疑問符/改行）で1エントリとして確定する Phase1 の簡易レンダラ。
     * ※ セグメント/時刻アライメントは優先度3で導入予定（ここでは時系列追記のみ）。
     *
     * @param {'input'|'output'} kind input=入力転写(左) / output=訳文(右)
     * @param {string} delta 追加テキスト
     */
    /**
     * 翻訳セッションのレイテンシ(原文認識の開始→訳出の開始)を観測して表示する。
     * 純粋な観測のみ。タイムスタンプ記録と表示更新だけで、翻訳処理には一切干渉しない。
     *
     * @param {'input'|'output'} role input=原文認識デルタ / output=訳文・訳音デルタ
     */
    recordTranslationLatency(role) {
        const now = Date.now();
        if (role === 'input') {
            if (this.latencyTurnStartAt == null) {
                this.latencyTurnStartAt = now;
            }
            return;
        }
        if (this.latencyTurnStartAt != null) {
            this.updateLatencyDisplay(now - this.latencyTurnStartAt);
            this.latencyTurnStartAt = null;
        }
    },

    handleTranslationTranscriptDelta(kind, delta) {
        if (!delta) {
            return;
        }
        this.recordTranslationLatency(kind === 'input' ? 'input' : 'output');
        if (!this.translationCaption) {
            this.translationCaption = { input: '', output: '' };
        }
        this.translationCaption[kind] += delta;
        const buffered = this.translationCaption[kind];
        // 文末標点で即確定。
        if (/[。．.!?！？\n]\s*$/.test(buffered)) {
            this.commitTranslationCaption(kind);
            return;
        }
        // 標点が来ない発話(特に左カラムの原文STT)対策: デルタが途切れたら確定する。
        this.scheduleTranslationCaptionFlush(kind);
    },

    /**
     * 指定カラムの字幕バッファを1エントリとして確定表示する。
     * アイドルflushタイマーも併せて解除する。
     *
     * @param {'input'|'output'} kind
     */
    commitTranslationCaption(kind) {
        if (this.captionFlushTimers && this.captionFlushTimers[kind]) {
            clearTimeout(this.captionFlushTimers[kind]);
            this.captionFlushTimers[kind] = null;
        }
        if (!this.translationCaption) {
            return;
        }
        const text = (this.translationCaption[kind] || '').trim();
        this.translationCaption[kind] = '';
        if (text && typeof this.addTranscript === 'function') {
            this.addTranscript(kind, text, null);
        }
    },

    /**
     * デルタが TRANSLATION_CAPTION_IDLE_MS 途切れたら確定するタイマーを張り直す。
     *
     * @param {'input'|'output'} kind
     */
    scheduleTranslationCaptionFlush(kind) {
        if (!this.captionFlushTimers) {
            this.captionFlushTimers = { input: null, output: null };
        }
        if (this.captionFlushTimers[kind]) {
            clearTimeout(this.captionFlushTimers[kind]);
        }
        this.captionFlushTimers[kind] = setTimeout(() => {
            this.captionFlushTimers[kind] = null;
            this.commitTranslationCaption(kind);
        }, TRANSLATION_CAPTION_IDLE_MS);
    },

    /**
     * 未確定の字幕バッファ（input/output）を確定して表示する。
     * セッション終了時に末尾の一文を取りこぼさないために呼ぶ。
     */
    flushTranslationCaptions() {
        if (!this.translationCaption) {
            return;
        }
        for (const kind of ['input', 'output']) {
            this.commitTranslationCaption(kind);
        }
    },

    /**
     * セッション更新イベント処理
     */
    handleSessionUpdated(message) {},

    /**
     * 音声バッファコミット完了処理
     *
     * 目的:
     *   音声バッファがコミットされた際の処理
     *   重複チェック、発話時長検証、音声データ抽出を実行
     */
    handleAudioBufferCommitted(message = {}) {
        const queueStatus = this.responseQueue.getStatus();
        const now = Date.now();
        const speechDuration = this.speechStartTime ? now - this.speechStartTime : 0;

        this.resetRealtimeInputAudioBufferStats();

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
        // isValidAudioDuration は「スキップすべき(無効)とき true」を返す契約のため、
        // 否定せずそのまま return 判定に使う（! を付けると有効音声を誤って破棄する）。
        if (this.isValidAudioDuration(totalLength, actualDuration)) {
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

        // ✅ このコミットの item_id を保持し、後段で collecting 中の segment へ bindItemId する。
        //    item_id で結ぶことで、flush 後に遅れて届く transcription.completed も
        //    正しい segment に戻せる（FIFO 順依存を排除）。
        this.pendingCommittedItemId = message.item_id || null;

        // ✅ groupedモード: 完結した発話（semantic_vad のターン）を client 側で
        //    最大 MAX_SENTENCES 文 / 最大 MAX_BUFFER_MS までまとめ、1つの
        //    AudioSegment として翻訳する。文脈を保ち、完全な音声で再生するため。
        if (this.isGroupedTurnMode()) {
            this.accumulateGroupedAudio(finalAudio, finalDuration, sampleRate, now);
            return;
        }

        this.tryEnqueueAudioSegment(finalAudio, finalDuration, sampleRate, now);
    },

    /**
     * groupedモード（整文1〜3句まとめ翻訳）が有効か
     *
     * @returns {boolean} CONFIG.TRANSLATION.TURN_MODE === 'grouped' のとき true
     */
    isGroupedTurnMode() {
        return !!(
            typeof CONFIG !== 'undefined' &&
            CONFIG.TRANSLATION &&
            CONFIG.TRANSLATION.TURN_MODE === 'grouped'
        );
    },

    /**
     * 完結ターンの音声を蓄積し、上限到達でまとめて enqueue する
     *
     * 区切り条件:
     *   - 文数が MIN_COMPLETE_SENTENCES 以上になった後、POST_SENTENCE_HOLD_MS だけ短く待つ
     *   - 文数が MAX_SENTENCES 以上（best-effort。ライブ入力転写から計数）
     *   - 蓄積時間が MAX_BUFFER_MS 以上（文末が来なくても確実に確定する保証）
     *
     * @param {Float32Array} audio - このターンの結合済み音声
     * @param {number} duration - このターンの時長（ms）
     * @param {number} sampleRate - サンプルレート
     * @param {number} now - 現在時刻（ms）
     */
    accumulateGroupedAudio(audio, duration, sampleRate, now) {
        if (!this.groupedAudioChunks || this.groupedAudioChunks.length === 0) {
            this.groupedAudioChunks = [];
            this.groupedAudioStartTime = now;
            this.groupedAudioDuration = 0;
            this.groupSentenceCount = this.groupSentenceCount || 0;
            if (this.segmentAlignment) {
                const segment = this.segmentAlignment.createSegment({
                    durationMs: 0,
                    sampleRate,
                    sourceLang: this.state.sourceLang,
                    status: 'collecting'
                });
                this.groupedSegmentId = segment.id;
                if (this.groupedPendingTranscriptText) {
                    const updated = this.segmentAlignment.updateInput(
                        segment.id,
                        this.groupedPendingTranscriptText,
                        {
                            isFinal: true,
                            source: 'live-sra',
                            sourceLang: this.textPathProcessor?.detectLanguageFromTranscript?.(
                                this.groupedPendingTranscriptText
                            )
                        }
                    );
                    this.upsertSegmentInput(updated.id, updated.input.text, {
                        status: 'input-ready'
                    });
                    this.upsertSegmentOutput(updated.id, updated.output.text, {
                        status: 'collecting',
                        placeholder: '翻訳待機中...'
                    });
                    this.groupedPendingTranscriptText = '';
                }
            }
        }
        // ✅ このターンの item_id を現在 collecting 中の grouped segment に結ぶ。
        //    1つの grouped segment が複数ターン（複数 item_id）を集約しても、全ターンが同じ segment に対応する。
        if (this.segmentAlignment && this.groupedSegmentId && this.pendingCommittedItemId) {
            this.segmentAlignment.bindItemId(this.pendingCommittedItemId, this.groupedSegmentId);
            this.pendingCommittedItemId = null;
        }
        this.groupedAudioChunks.push(audio);
        this.groupedAudioDuration += duration;
        this.groupedSampleRate = sampleRate;

        this.maybeFlushGroupedAudio(now);
        // 文末が来なくても MAX_BUFFER_MS で確実に flush するための保険タイマー
        this.scheduleGroupedFlush();
    },

    /**
     * groupベースの文数を加算する（ライブ入力転写から呼ばれる）
     *
     * @param {string} transcript - 入力音声の文字起こし
     */
    addGroupedSentenceCount(transcript) {
        if (!this.isGroupedTurnMode() || !transcript) {
            return;
        }
        const count = this.countCompleteSentences(transcript);
        this.groupSentenceCount = (this.groupSentenceCount || 0) + count;
        this.groupLastSentenceAt = Date.now();
        this.maybeFlushGroupedAudio(Date.now());
    },

    /**
     * semantic_vad の completed transcript は意味的に完結した発話として扱う。
     * 句読点がある場合は句読点数、無い場合は1文として数える。
     *
     * @param {string} transcript
     * @returns {number}
     */
    countCompleteSentences(transcript) {
        const text = (transcript || '').trim();
        if (!text) {
            return 0;
        }

        const matches = text.match(/[。．.!?！？]+/g);
        return Math.max(matches ? matches.length : 0, 1);
    },

    /**
     * 上限到達をチェックし、達していれば flush する
     *
     * @param {number} now - 現在時刻（ms）
     */
    maybeFlushGroupedAudio(now) {
        if (!this.groupedAudioChunks || this.groupedAudioChunks.length === 0) {
            return;
        }
        const minCompleteSentences =
            (CONFIG.TRANSLATION && CONFIG.TRANSLATION.MIN_COMPLETE_SENTENCES) || 1;
        const maxSentences = (CONFIG.TRANSLATION && CONFIG.TRANSLATION.MAX_SENTENCES) || 3;
        const maxBufferMs = (CONFIG.TRANSLATION && CONFIG.TRANSLATION.MAX_BUFFER_MS) || 6000;
        const elapsed = now - (this.groupedAudioStartTime || now);
        const sentenceCount = this.groupSentenceCount || 0;

        const reachedSentences = sentenceCount >= maxSentences;
        const reachedTime = elapsed >= maxBufferMs || this.groupedAudioDuration >= maxBufferMs;

        if (reachedSentences || reachedTime) {
            this.clearGroupedPostSentenceTimer();
            this.flushGroupedAudio(now);
            return;
        }

        if (sentenceCount >= minCompleteSentences) {
            this.scheduleGroupedPostSentenceFlush();
        }
    },

    /**
     * MAX_BUFFER_MS 到達時に確実に flush するための保険タイマーを仕込む
     */
    scheduleGroupedFlush() {
        if (this.groupedFlushTimer) {
            return;
        }
        const maxBufferMs = (CONFIG.TRANSLATION && CONFIG.TRANSLATION.MAX_BUFFER_MS) || 6000;
        const elapsed = Date.now() - (this.groupedAudioStartTime || Date.now());
        const remaining = Math.max(0, maxBufferMs - elapsed);
        this.groupedFlushTimer = setTimeout(() => {
            this.groupedFlushTimer = null;
            this.maybeFlushGroupedAudio(Date.now());
        }, remaining + 50);
    },

    /**
     * 最小完全文数に達した後、短い猶予だけ待って flush する。
     */
    scheduleGroupedPostSentenceFlush() {
        if (this.groupedPostSentenceTimer) {
            return;
        }

        const holdMs = (CONFIG.TRANSLATION && CONFIG.TRANSLATION.POST_SENTENCE_HOLD_MS) || 500;
        this.groupedPostSentenceTimer = setTimeout(() => {
            this.groupedPostSentenceTimer = null;
            if (!this.groupedAudioChunks || this.groupedAudioChunks.length === 0) {
                return;
            }

            const minCompleteSentences =
                (CONFIG.TRANSLATION && CONFIG.TRANSLATION.MIN_COMPLETE_SENTENCES) || 1;
            if ((this.groupSentenceCount || 0) >= minCompleteSentences) {
                this.flushGroupedAudio(Date.now());
            }
        }, holdMs);
    },

    clearGroupedPostSentenceTimer() {
        if (this.groupedPostSentenceTimer) {
            clearTimeout(this.groupedPostSentenceTimer);
            this.groupedPostSentenceTimer = null;
        }
    },

    /**
     * 蓄積した音声を結合し、1つの AudioSegment として enqueue する
     *
     * @param {number} now - 現在時刻（ms）
     */
    flushGroupedAudio(now) {
        if (this.groupedFlushTimer) {
            clearTimeout(this.groupedFlushTimer);
            this.groupedFlushTimer = null;
        }
        this.clearGroupedPostSentenceTimer();
        const chunks = this.groupedAudioChunks || [];
        if (chunks.length === 0) {
            return;
        }

        let totalLength = 0;
        for (const c of chunks) {
            totalLength += c.length;
        }
        const combined = new Float32Array(totalLength);
        let offset = 0;
        for (const c of chunks) {
            combined.set(c, offset);
            offset += c.length;
        }
        const duration = this.groupedAudioDuration;
        const sampleRate = this.groupedSampleRate || 24000;

        // グループ状態をリセット（enqueue 前にリセットして再入を防ぐ）
        this.groupedAudioChunks = [];
        this.groupedAudioDuration = 0;
        this.groupedAudioStartTime = null;
        this.groupSentenceCount = 0;
        this.groupLastSentenceAt = null;
        this.groupedPendingTranscriptText = '';

        const segmentId = this.groupedSegmentId || null;
        this.groupedSegmentId = null;

        if (
            !this.tryEnqueueAudioSegment(combined, duration, sampleRate, now || Date.now(), {
                segmentId
            })
        ) {
        }
    },

    /**
     * groupedモードの蓄積状態をリセットする（録音停止/開始時に呼ぶ）
     */
    resetGroupedAudioState() {
        if (this.groupedFlushTimer) {
            clearTimeout(this.groupedFlushTimer);
            this.groupedFlushTimer = null;
        }
        this.clearGroupedPostSentenceTimer();
        this.groupedAudioChunks = [];
        this.groupedAudioDuration = 0;
        this.groupedAudioStartTime = null;
        this.groupSentenceCount = 0;
        this.groupLastSentenceAt = null;
        this.groupedPendingTranscriptText = '';
        this.groupedSegmentId = null;
        this.pendingCommittedItemId = null;
    },

    /**
     * 重複コミットをチェック（800ms以内の重複を無視）
     * @param {number} now - 現在のタイムスタンプ
     * @returns {boolean} 重複コミットの場合は true
     */
    isDuplicateCommit(now) {
        if (now - this.lastCommitTime < 800) {
            // ✅ 500ms → 800ms に変更（音声結巴を防ぐ）
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
            this.silenceConfirmTimer = null;
            return;
        }

        const finalDuration = Date.now() - this.speechStartTime;
        if (finalDuration >= this.minSpeechDuration) {
            // 再帰呼び出し（但し今回は時長チェックをパスする）
            this.speechStartTime = null; // リセットしてチェックをスキップ
            this.handleAudioBufferCommitted();
        } else {
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
            return true;
        }

        // ✅ 修正: 最小音声時長を 300ms に設定（品質優先）
        // 理由: 短い単語や文の前半部分も重要（例: "Yes", "OK", "I think..."）
        //       300ms未満は明らかなノイズ・クリック音のみスキップ
        if (actualDuration < 300) {
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
        } else {
            // 2回目以降: 既存のバッファと結合
            const combined = new Float32Array(this.pendingAudioBuffer.length + audioData.length);
            combined.set(this.pendingAudioBuffer, 0);
            combined.set(audioData, this.pendingAudioBuffer.length);
            this.pendingAudioBuffer = combined;
            this.pendingAudioDuration += duration;
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

            // ✅ 修正: 保留バッファを直接キューに送信（handleAudioBufferCommitted を再帰呼び出ししない）
            const bufferedAudio = this.pendingAudioBuffer;
            const bufferedDuration = this.pendingAudioDuration;

            // バッファをクリア（無限ループ防止）
            this.clearPendingBuffer();

            // ✅ 直接キューに追加（grouped時は同じグループに蓄積）
            const sampleRate = this.state.audioContext?.sampleRate || 24000;
            this.queueOrAccumulateAudioSegment(
                bufferedAudio,
                bufferedDuration,
                sampleRate,
                Date.now()
            );
        }, this.pendingAudioTimeout);

        // ✅ 保留バッファが300ms以上になったら即座に送信
        if (this.pendingAudioDuration >= 300) {
            clearTimeout(this.pendingAudioTimer);

            // ✅ 修正: 保留バッファを直接キューに送信（handleAudioBufferCommitted を再帰呼び出ししない）
            const bufferedAudio = this.pendingAudioBuffer;
            const bufferedDuration = this.pendingAudioDuration;

            // バッファをクリア（無限ループ防止）
            this.clearPendingBuffer();

            // ✅ 直接キューに追加（grouped時は同じグループに蓄積）
            const sampleRate = this.state.audioContext?.sampleRate || 24000;
            this.queueOrAccumulateAudioSegment(
                bufferedAudio,
                bufferedDuration,
                sampleRate,
                Date.now()
            );
        }
    },

    /**
     * 現在のターンモードに合わせて音声を蓄積または enqueue する。
     *
     * @param {Float32Array} audioData
     * @param {number} duration
     * @param {number} sampleRate
     * @param {number} now
     */
    queueOrAccumulateAudioSegment(audioData, duration, sampleRate, now) {
        if (this.isGroupedTurnMode()) {
            this.accumulateGroupedAudio(audioData, duration, sampleRate, now);
            return;
        }

        this.tryEnqueueAudioSegment(audioData, duration, sampleRate, now);
    },

    /**
     * 音声セグメントをキューに追加
     * @param {Float32Array} combinedAudio - 結合された音声データ
     * @param {number} actualDuration - 音声時長（ms）
     * @param {number} sampleRate - サンプルレート
     * @param {number} now - 現在のタイムスタンプ
     * @returns {boolean} 成功した場合は true
     */
    tryEnqueueAudioSegment(combinedAudio, actualDuration, sampleRate, now, options = {}) {
        // ✅ デバッグ：tryEnqueueAudioSegment 呼び出し確認

        // ✅ 新アーキテクチャ有効化フラグを設定
        this.useAudioQueue = true;

        if (!this.segmentAlignment) {
            this.notify?.('音声翻訳エラー', 'Segment alignment layer is not initialized', 'error');
            return false;
        }

        const alignmentSegment = this.segmentAlignment.ensureSegment(options.segmentId, {
            durationMs: actualDuration,
            sampleRate,
            sourceLang: this.state.sourceLang,
            status: 'queued'
        });

        // ✅ 有効な音声データのみをキューに追加
        const segment = this.audioQueue.enqueue(combinedAudio, {
            segmentId: alignmentSegment?.id || options.segmentId,
            duration: actualDuration,
            language: this.state.sourceLang,
            sourceType: this.state.audioSourceType,
            timestamp: now,
            sampleRate: sampleRate
        });

        if (!segment) {
            this.segmentAlignment.recordError(alignmentSegment.id, 'AudioQueue enqueue failed');
            return false;
        }

        const aligned = this.segmentAlignment.ensureSegment(segment.id, {
            durationMs: actualDuration,
            sampleRate,
            sourceLang: this.state.sourceLang,
            status: 'queued'
        });
        segment.alignment = {
            ...segment.alignment,
            id: aligned.id,
            inputText: aligned.input.text,
            outputText: aligned.output.text
        };
        if (!aligned.input.isFinal && !aligned.input.text) {
            this.segmentAlignment.enqueueInputSegment(segment.id);
        }
        // ✅ 非groupedパスでも item_id を結び、転写完了を順序非依存で正しい segment に戻す。
        if (this.pendingCommittedItemId) {
            this.segmentAlignment.bindItemId(this.pendingCommittedItemId, segment.id);
            this.pendingCommittedItemId = null;
        }
        this.upsertSegmentInput(segment.id, aligned.input.text, {
            status: aligned.input.text ? 'input-ready' : 'transcribing',
            placeholder: '認識中...'
        });
        this.upsertSegmentOutput(segment.id, aligned.output.text, {
            status: 'queued',
            placeholder: '翻訳待機中...'
        });

        // 双パス処理は startPathConsumers() の pull-based loop が消費する。
        return true;
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

        this.updateStatus('recording', '話し中...');
    },

    /**
     * 発話停止イベント処理
     */
    handleSpeechStopped() {
        const duration = this.speechStartTime ? Date.now() - this.speechStartTime : 0;
        this.updateStatus('recording', '処理中...');
        this.state.isNewResponse = true;
    },

    /**
     * 入力音声認識完了イベント処理
     */
    handleTranscriptionCompleted(message) {
        if (message.transcript) {
            // ✅ item_id 優先解決: コミット時に結んだ segment へ確実に戻す。
            //    flush 後に遅れて届く転写でも、commit 時点の正しい segment に入り、
            //    後続グループを汚染しない（順序非依存の 1:1 対応保証）。
            if (this.useAudioQueue && this.segmentAlignment && !this.segmentResendDepth) {
                const boundSegment = this.segmentAlignment.getSegmentByItemId(message.item_id);
                if (boundSegment) {
                    const nextText = this.joinSegmentTranscriptText(
                        boundSegment.input.text,
                        message.transcript
                    );
                    const segment = this.segmentAlignment.updateInput(boundSegment.id, nextText, {
                        isFinal: true,
                        source: 'live-sra',
                        sourceLang: this.textPathProcessor?.detectLanguageFromTranscript?.(nextText)
                    });
                    this.upsertSegmentInput(segment.id, segment.input.text, {
                        status: 'input-ready'
                    });
                    this.upsertSegmentOutput(segment.id, segment.output.text, {
                        status: segment.output.responseId ? 'responding' : 'collecting',
                        placeholder: '翻訳待機中...'
                    });
                    // 文数計数は「現在 collecting 中のグループ」に属する転写のみ。
                    // flush 済みグループの遅延転写は次グループの flush を誤って早めない。
                    if (this.isGroupedTurnMode() && this.groupedSegmentId === boundSegment.id) {
                        this.addGroupedSentenceCount(message.transcript);
                    }
                    return;
                }
            }
            let handledByCurrentGroup = false;
            // ✅ groupedモード: ライブ入力転写から文数を計数して区切りを判断する。
            //    Path1 の音声再送で発生する転写は二重計数になるため除外する。
            if (this.isGroupedTurnMode() && !this.segmentResendDepth) {
                const belongsToFlushedPendingSegment = !!(
                    this.useAudioQueue &&
                    !this.groupedSegmentId &&
                    this.segmentAlignment?.pendingInputSegments?.length
                );
                if (!belongsToFlushedPendingSegment) {
                    this.addGroupedSentenceCount(message.transcript);
                }
                if (this.segmentAlignment && this.groupedSegmentId) {
                    const existing = this.segmentAlignment.getSegment(this.groupedSegmentId);
                    const nextText = this.joinSegmentTranscriptText(
                        existing?.input.text,
                        message.transcript
                    );
                    const segment = this.segmentAlignment.updateInput(
                        this.groupedSegmentId,
                        nextText,
                        {
                            isFinal: true,
                            source: 'live-sra',
                            sourceLang:
                                this.textPathProcessor?.detectLanguageFromTranscript?.(nextText)
                        }
                    );
                    this.upsertSegmentInput(segment.id, segment.input.text, {
                        status: 'input-ready'
                    });
                    this.upsertSegmentOutput(segment.id, segment.output.text, {
                        status: 'collecting',
                        placeholder: '翻訳待機中...'
                    });
                    handledByCurrentGroup = true;
                } else if (!belongsToFlushedPendingSegment) {
                    this.groupedPendingTranscriptText = this.joinSegmentTranscriptText(
                        this.groupedPendingTranscriptText,
                        message.transcript
                    );
                    handledByCurrentGroup = true;
                }
            }
            if (handledByCurrentGroup) {
                return;
            }
            if (this.useAudioQueue) {
                if (this.segmentAlignment && !this.segmentResendDepth) {
                    const segment = this.segmentAlignment.completeNextInput(message.transcript, {
                        source: 'live-sra',
                        sourceLang: this.textPathProcessor?.detectLanguageFromTranscript?.(
                            message.transcript
                        )
                    });
                    if (segment) {
                        this.upsertSegmentInput(segment.id, segment.input.text, {
                            status: 'input-ready'
                        });
                        this.upsertSegmentOutput(segment.id, segment.output.text, {
                            status: 'queued',
                            placeholder: '翻訳待機中...'
                        });
                    }
                }
                return;
            }
        }
    },

    /**
     * 入力音声認識失敗イベント処理
     *
     * 目的:
     *   OpenAI が転写失敗（無音・雑音・短すぎ等）を返したとき、対象セグメントの
     *   「認識中...」プレースホルダを確実に解放する。あわせて pendingInputSegments
     *   から該当セグメントを除去し、以降の completeNextInput() の FIFO shift が
     *   1 つずれて後続の左右対応を崩すのを防ぐ（識別欠落＋左右ズレの根本対策）。
     *
     * @param {Object} message - transcription.failed イベント
     */
    handleTranscriptionFailed(message = {}) {
        // 音声再送中（Path1 STS）に発生する失敗は二重処理になるため無視する。
        if (!this.useAudioQueue || !this.segmentAlignment || this.segmentResendDepth) {
            return;
        }

        // item_id で結んだ segment を優先解決。無ければ FIFO 先頭を失敗対象とする。
        let segment = this.segmentAlignment.getSegmentByItemId(message.item_id);
        if (!segment) {
            const segmentId = this.segmentAlignment.pendingInputSegments[0];
            segment = segmentId ? this.segmentAlignment.getSegment(segmentId) : null;
        }
        if (!segment) {
            return;
        }

        // 収集中の grouped セグメントは複数ターン（複数 item_id）を集約するため、
        // 1 ターンの失敗で全体を error にせず、後続ターン／flush の確定に委ねる。
        if (this.groupedSegmentId && segment.id === this.groupedSegmentId) {
            this.segmentAlignment.recordError(
                segment.id,
                message.error || '音声認識に失敗しました'
            );
            return;
        }

        // 待ちキューから確実に除去（以降の shift ずれを防ぐ）。
        this.segmentAlignment.dequeueInputSegment(segment.id);
        this.segmentAlignment.recordError(segment.id, message.error || '音声認識に失敗しました');

        // 既に部分認識テキストがあれば残し、無ければ失敗を明示する。
        const failedText = segment.input.text || '（音声認識できませんでした）';
        const updated = this.segmentAlignment.updateInput(segment.id, failedText, {
            isFinal: true,
            status: 'error'
        });
        this.upsertSegmentInput(updated.id, updated.input.text, { status: 'error' });
    },

    /**
     * @param {string} previous
     * @param {string} next
     * @returns {string}
     */
    joinSegmentTranscriptText(previous, next) {
        const left = (previous || '').trim();
        const right = (next || '').trim();
        if (!left) {
            return right;
        }
        if (!right) {
            return left;
        }

        const shouldInsertSpace = /[A-Za-z0-9]$/.test(left) && /^[A-Za-z0-9]/.test(right);
        return shouldInsertSpace ? `${left} ${right}` : `${left}${right}`;
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
        // ✅ groupedモードでは grouping を accumulateGroupedAudio() が担うため、
        //    旧来の手動コミット経路は無効化する（二重コミット防止）。
        if (this.isGroupedTurnMode()) {
            return;
        }
        if (!this.isBufferingAudio || !this.audioBufferStartTime) {
            return; // 未在缓冲中
        }

        const bufferDuration = Date.now() - this.audioBufferStartTime;
        const shouldCommitBySentenceCount = this.sentenceCount >= this.targetSentenceCount;
        const shouldCommitByDuration = bufferDuration >= this.maxBufferDuration;

        if (shouldCommitBySentenceCount || shouldCommitByDuration) {
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
            return;
        }

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
     * 音声デルタ受信処理
     */
    handleAudioDelta(message) {
        if (message.delta) {
            let segment = null;
            if (this.useAudioQueue && this.segmentAlignment) {
                segment = this.segmentAlignment.appendOutputAudioByResponse(message.response_id);
                if (!segment) {
                    // ✅ 未バインドでも翻訳音声は捨てない（STS の中核機能のサイレント失敗を防ぐ）。
                    //    segment 追跡はできないが、ベストエフォートで再生しログで識別可能にする。
                }
            }

            this.playAudioChunk(message.delta, {
                responseId: message.response_id || null,
                segmentId: segment?.id || null
            });
        }
    },

    /**
     * 音声データ受信完了処理
     */
    handleAudioDone(message = {}) {
        if (this.segmentAlignment && message.response_id) {
            this.segmentAlignment.markOutputAudioDone(message.response_id);
        }
    },

    /**
     * レスポンス作成イベント処理
     */
    handleResponseCreated(message) {
        if (this.segmentAlignment && this.useAudioQueue) {
            const segment = this.segmentAlignment.bindNextResponse(message.response.id);
            if (segment) {
                this.upsertSegmentOutput(segment.id, segment.output.text, {
                    responseId: message.response.id,
                    status: 'responding',
                    placeholder: '翻訳中...'
                });
            }
        } else {
        }

        // ✅ プル型アーキテクチャ: activeResponseId のみ記録（デバッグ用）
        this.activeResponseId = message.response.id;
        this.responseQueue.handleResponseCreated(message.response.id);
    },

    /**
     * レスポンス完了イベント処理
     */
    handleResponseDone(message) {
        // ✅ プル型アーキテクチャ: 状態をクリア
        this.activeResponseId = null;
        if (this.segmentAlignment && message.response?.id) {
            const segment = this.segmentAlignment.markResponseDone(message.response.id);
            if (segment && segment.output.text) {
                this.upsertSegmentOutput(segment.id, segment.output.text, {
                    responseId: message.response.id,
                    status: 'done'
                });
            }
        }
        // ✅ ResponseQueue が自動的に次のリクエストを送信（consume()）
        this.responseQueue.handleResponseDone(message.response.id);
        this.updateStatus('recording', '待機中');
        this.updateAccuracy();
    },

    /**
     * WebSocketメッセージエラー処理
     */
    handleWSMessageError(message) {
        const errorCode = message.error.code || '';
        if (errorCode === 'conversation_already_has_active_response') {
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
    sendAudioData(audioData, options = {}) {
        const force = !!options.force;
        // ✅ WebRTC 経路では音声はメディアトラックで送るため PCM append は不要（送らない）
        if (this.usesWebRtcTransport()) {
            return false;
        }
        // 接続状態チェック
        if (!this.state.isConnected) {
            return false;
        }

        // 録音状態チェック
        if (!this.state.isRecording && !force) {
            return false;
        }

        if (!audioData || audioData.length === 0) {
            return false;
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
        const isSystemMode = this.state.audioSourceType === 'system';
        const isMicrophoneMode = !isSystemMode;

        // 経路隔離が成立する場合のみ「再生中も連続採集」を許可（不漏訳）。
        // 条件: システム音声モード + 翻訳セッション + 翻訳音声の出力が別デバイスへ分離済み。
        // 未分離（既定出力＝採集対象の恐れ）や非翻訳セッションでは従来どおり再生中スキップ。
        const continuousCapture =
            isSystemMode && this.isRealtimeTranslationSession() && this.isOutputDeviceIsolated();

        let shouldSkip;
        if (continuousCapture) {
            // 出力は別デバイスへ隔離済み → 自分の訳音再生中も対方の発話を落とさない
            shouldSkip = false;
        } else {
            // 従来挙動: 再生中はスキップ（マイク回灌防止／未分離システム音声）
            shouldSkip = isPlayingAudio;

            if (isMicrophoneMode && !isPlayingAudio) {
                // マイクモード: 再生終了後もバッファウィンドウ内はスキップ
                const timeSincePlaybackEnd = this.audioSourceTracker.outputEndTime
                    ? now - this.audioSourceTracker.outputEndTime
                    : Infinity;
                const isWithinBufferWindow =
                    timeSincePlaybackEnd < this.audioSourceTracker.bufferWindow;

                if (isWithinBufferWindow) {
                    shouldSkip = true;
                }
            }
        }

        if (shouldSkip && !force) {
            return false;
        }

        // Float32をPCM16に変換（即座に送信、節流なし）
        const pcmData = Utils.floatTo16BitPCM(audioData);
        const base64Audio = Utils.arrayBufferToBase64(pcmData);

        const message = {
            type: this.isRealtimeTranslationSession()
                ? 'session.input_audio_buffer.append'
                : 'input_audio_buffer.append',
            audio: base64Audio
        };

        this.sendMessage(message);
        this.recordRealtimeInputAudioAppend(audioData);
        return true;
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
    async playAudioChunk(base64Audio, metadata = {}) {
        try {
            // 再生キューに追加
            this.playbackQueue.push({
                audio: base64Audio,
                segmentId: metadata.segmentId || null,
                responseId: metadata.responseId || null
            });

            // 再生中でなければ再生開始
            if (!this.isPlayingFromQueue) {
                this.playNextInQueue();
            }
        } catch (error) {
            this.handleAudioPlaybackError(error);
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
            }

            return;
        }

        // 再生中フラグをON
        this.isPlayingFromQueue = true;

        // キューから最初の音声を取り出す
        const queueItem = this.playbackQueue.shift();
        if (!queueItem || typeof queueItem.audio !== 'string') {
            this.playNextInQueue();
            return;
        }
        const audioData = queueItem.audio;

        // 音声を再生（await しない - 非同期で開始）
        this.playAudio(audioData).catch((error) => {
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
            // 選択済みの出力先（原声分離用の物理デバイス）を適用
            await this.applyOutputSink();
        }

        // AudioContextがsuspended状態の場合はresume
        if (this.state.outputAudioContext.state === 'suspended') {
            await this.state.outputAudioContext.resume();
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
        this.notify('音声再生エラー', error.message, 'error');

        // エラー時もフラグをOFF（すべてのモードで適用）
        this.state.isPlayingAudio = false;

        // 入力音声を復元
        if (this.state.inputGainNode) {
            this.state.inputGainNode.gain.value = this.state.inputAudioOutputEnabled ? 1 : 0;
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
                } catch (cleanupError) {
                    // 解放処理の失敗は無害なため無視
                }

                // ✅ 出力完了時刻を記録（バッファウィンドウの計算用）
                this.audioSourceTracker.outputEndTime = Date.now();
                this.audioSourceTracker.playbackTokens.delete(playbackToken);
                this.handleAudioPlaybackEnded();
            };

            source.start();
        } catch (error) {
            // ✅ エラー時もトークンをクリア
            this.audioSourceTracker.playbackTokens.delete(playbackToken);
            this.handleAudioPlaybackError(error);
            throw error;
        }
    },

    /**
     * ✅ 音声セグメント完全処理完了
     *
     * @param {AudioSegment} segment 音声セグメント
     */
    handleSegmentComplete(segment) {
        // 統計情報更新
        const stats = this.audioQueue.getStats();

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
        // イベントオブジェクトの安全な取得
        const code = event?.code || event || 1005;
        const reason = event?.reason || '';
        const wasClean = event?.wasClean !== undefined ? event.wasClean : true;

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
            // 正常切断の場合は通知を表示しない
        } else {
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
