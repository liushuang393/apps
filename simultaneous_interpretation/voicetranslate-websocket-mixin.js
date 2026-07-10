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

// 観測トレース（リングバッファ）の上限件数。実セッションのイベント列とペアリング判断を
// 後から検証するための基盤（推測駆動の再発防止。判定は体感でなく計測で行う）。
const TRANSLATION_TRACE_MAX = 500;

// 公式手順(session.close→session.closed)の応答待ち上限。応答が無くても切断を進める。
const TRANSLATION_CLOSE_TIMEOUT_MS = 2000;

// 送信失敗通知の間引き間隔。音声チャンクは高頻度のため、通知洪水を避けつつ欠落を可視化する。
const SEND_FAILURE_NOTIFY_INTERVAL_MS = 30000;

const WebSocketMixin = {
    /**
     * WebSocketメッセージ送信
     *
     * 目的:
     *   Electron環境とブラウザ環境の両方に対応したメッセージ送信
     *
     * 入力:
     *   message: 送信するメッセージオブジェクト
     *   options.silentFailure: true なら失敗通知を出さない（切断処理中の session.close 等）
     *
     * @returns {Promise<boolean>} 送信に成功したか。失敗は noteRealtimeSendFailure で可視化する
     *   （黙って成功扱いにすると音声・字幕の欠落が STT タイムアウトにしか見えなくなるため）。
     */
    async sendMessage(message, options = {}) {
        // transport 種別はセッション開始時に確定した記述子(this.transport.kind)を1箇所で読む。
        // isElectron/usesWebRtcTransport をここで再導出しない（送信機構の分岐を単一源化）。
        if (this.transport.kind === TRANSPORT_KINDS.ELECTRON_IPC) {
            // Electron環境（mainプロセス経由IPC）
            const result = await this.platform.sendRealtime(message);
            if (!result || !result.success) {
                if (!options.silentFailure) {
                    this.noteRealtimeSendFailure(result && result.message);
                }
                return false;
            }
            return true;
        }
        if (this.transport.kind === TRANSPORT_KINDS.BROWSER_WEBRTC) {
            // ブラウザ/拡張機能の翻訳エンドポイント（WebRTC データチャネル）
            const dc = this.state.dataChannel;
            if (dc && dc.readyState === 'open') {
                dc.send(JSON.stringify(message));
                return true;
            }
            if (!options.silentFailure) {
                this.noteRealtimeSendFailure('データチャネルが未接続です');
            }
            return false;
        }
        // BROWSER_WS（ブラウザ WebSocket）
        if (this.state.ws && this.state.ws.readyState === WebSocket.OPEN) {
            this.state.ws.send(JSON.stringify(message));
            return true;
        }
        if (!options.silentFailure) {
            this.noteRealtimeSendFailure('WebSocketが未接続です');
        }
        return false;
    },

    /**
     * 送信失敗をユーザーへ可視化する（静かな取りこぼしの禁止）。
     * 音声チャンクは高頻度で送信されるため、通知は間引く（欠落の可視化と通知洪水回避の両立）。
     *
     * @param {string} [detail] 失敗理由
     */
    noteRealtimeSendFailure(detail) {
        const now = Date.now();
        if (
            this._lastSendFailureNotifyAt &&
            now - this._lastSendFailureNotifyAt < SEND_FAILURE_NOTIFY_INTERVAL_MS
        ) {
            return;
        }
        this._lastSendFailureNotifyAt = now;
        const suffix = detail ? `（${detail}）` : '';
        this.notify?.(
            '送信エラー',
            `サーバへの送信に失敗しました。音声・字幕が欠落した可能性があります${suffix}`,
            'error'
        );
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

    commitRealtimeInputAudioBuffer(reason = 'manual-commit') {
        // server VAD OFF 時の Path1 STT 再送のみがここに到達する（VAD ON では sendAudioToServer が
        // 手前で return し、連続翻訳ストリームはこの関数を呼ばない）。非 server-VAD では手動 commit
        // しないと OpenAI が転写を開始しないため、最小長を満たせば commit、満たなければ破棄する。
        const stats = this.getRealtimeInputAudioBufferStats();
        if (stats.durationMs < REALTIME_MIN_COMMIT_AUDIO_MS) {
            this.sendMessage({ type: 'input_audio_buffer.clear' });
            this.resetRealtimeInputAudioBufferStats();
            return false;
        }

        this.sendMessage({ type: 'input_audio_buffer.commit' });
        this.resetRealtimeInputAudioBufferStats();
        return true;
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
        if (this.transport.kind === TRANSPORT_KINDS.ELECTRON_IPC) {
            return !!this.state.isConnected;
        }
        if (this.transport.kind === TRANSPORT_KINDS.BROWSER_WEBRTC) {
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
     * WebSocketメッセージをディスパッチ
     *
     * 目的:
     *   メッセージタイプに応じて適切なハンドラーを呼び出す
     *
     * 入力:
     *   message: WebSocketメッセージオブジェクト
     */
    dispatchWSMessage(message) {
        // 観測トレース: 全受信イベントを記録（本文テキストは保存しない。長さのみ）
        const traceLen =
            typeof message.delta === 'string'
                ? message.delta.length
                : typeof message.transcript === 'string'
                  ? message.transcript.length
                  : undefined;
        this.traceTranslation(message.type || 'unknown', { len: traceLen });
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
                if (message.delta && !this.transport.playsRemoteAudioTrack) {
                    this.playAudioChunk(message.delta, { responseId: null, segmentId: null });
                }
                break;
            // ▼ 3経路分離（公式仕様: /v1/realtime/translations は conversation.item.* /
            //   response.* を発行しない。字幕は session.*_transcript.delta の連続ストリームで届き、
            //   item_id 等の左右対応キーは無い）:
            //   路径1(识别): session.input_transcript.delta → 左カラムへライブ表示、
            //     入力確定（.done またはアイドル）で行対（segment）として確定する。
            //   路径2(声音实时翻译): session.output_transcript.delta → 右カラムへライブ表示、
            //     入力確定時に同じ行対の右セルへ吸収（never-empty＝不漏）。音声は session.output_audio。
            //   路径3(补精度): 入力確定文を Chat 高精度翻訳し、同じ行対の右セルを確定更新（准）。
            case 'session.input_transcript.delta':
                this.handleTranslationTranscriptDelta('input', message.delta);
                break;
            case 'session.output_transcript.delta':
                this.handleTranslationTranscriptDelta('output', message.delta);
                break;
            // セグメント終端イベントで確定する（句末標点に依存しない正規の境界）。
            // API のイベント名揺れに備えて .done / .completed の両方を受ける。
            // .done が来ない場合はアイドル確定（scheduleTranslationCaptionFlush）が保険。
            case 'session.input_transcript.done':
            case 'session.input_transcript.completed':
                this.commitTranslationCaption('input');
                break;
            case 'session.output_transcript.done':
            case 'session.output_transcript.completed':
                this.commitTranslationCaption('output');
                break;
            case 'session.closed':
                // 公式手順: session.close 後にサーバが残余の翻訳出力を flush してから返す確認応答。
                // 末尾の字幕を確定し、graceful close の待機を解除する。
                this.flushTranslationCaptions();
                if (this._sessionClosedWaiter) {
                    this._sessionClosedWaiter();
                }
                break;
            case 'error':
                this.handleWSMessageError(message);
                break;
            default:
                // 未処理イベントの取り漏らし検出（完了系イベントに対する失敗イベント等）。
                // トレースに unhandled として残し、実機検証ループで発見できるようにする。
                this.traceTranslation('unhandled:' + message.type);
        }
    },

    /**
     * 観測トレースへ1行記録する（リングバッファ、上限 TRANSLATION_TRACE_MAX 件）。
     *
     * 目的:
     *   実セッションのイベント列とペアリング判断を後から検証可能にする（推測駆動の再発防止）。
     *   プライバシーのため本文テキストは保存せず、種別・長さ・segmentId 等の小データのみ記録。
     *
     * @param {string} kind イベントtype または ペアリング判断名（pair:enqueue 等）
     * @param {Object} [detail] 追加の小データ（len/seg/queue 等）
     */
    traceTranslation(kind, detail) {
        if (!this._translationTrace) {
            this._translationTrace = [];
        }
        const entry = { t: Date.now(), kind };
        if (detail) {
            Object.assign(entry, detail);
        }
        this._translationTrace.push(entry);
        if (this._translationTrace.length > TRANSLATION_TRACE_MAX) {
            this._translationTrace.shift();
        }
    },

    /**
     * 観測トレースの要約を作成しコンソールへ出力する（実機検証ループの判定材料）。
     *
     * 要約: イベント種別ごとの件数 / 認識delta数と左右行数の整合 / 行対ごとの段階レイテンシ
     * （入力確定→ストリーム確定、入力確定→Chat確定）の中央値・最大。切断時に自動で呼ばれるほか、
     * DevTools から window.app.dumpTranslationTrace() で随時取得できる。
     *
     * @returns {Object} 要約オブジェクト（貼り付け共有用）
     */
    dumpTranslationTrace() {
        const trace = this._translationTrace || [];
        const counts = {};
        for (const entry of trace) {
            counts[entry.kind] = (counts[entry.kind] || 0) + 1;
        }
        const bySeg = {};
        for (const entry of trace) {
            if (!entry.seg) {
                continue;
            }
            if (!bySeg[entry.seg]) {
                bySeg[entry.seg] = {};
            }
            const seg = bySeg[entry.seg];
            if (
                (entry.kind === 'pair:enqueue' || entry.kind === 'pair:claim-held') &&
                seg.committed == null
            ) {
                seg.committed = entry.t;
            }
            if (entry.kind === 'output:finalize' && seg.streamDone == null) {
                seg.streamDone = entry.t;
            }
            if (entry.kind === 'refine:apply' && seg.refined == null) {
                seg.refined = entry.t;
            }
        }
        const collect = (key) =>
            Object.values(bySeg)
                .filter((s) => s.committed != null && s[key] != null)
                .map((s) => s[key] - s.committed)
                .sort((a, b) => a - b);
        const stats = (arr) =>
            arr.length
                ? {
                      n: arr.length,
                      median: arr[Math.floor(arr.length / 2)],
                      max: arr[arr.length - 1]
                  }
                : { n: 0 };
        // console へは一切出力しない（ユーザー方針）。DevTools で app.dumpTranslationTrace() を
        // 実行すれば戻り値として表示される。直近のイベント列も recent に含めて返す。
        return {
            events: counts,
            inputDeltaCount: counts['session.input_transcript.delta'] || 0,
            leftRows:
                this.getTranscriptContainer?.('input')?.querySelectorAll('.transcript-message')
                    .length ?? null,
            rightRows:
                this.getTranscriptContainer?.('output')?.querySelectorAll('.transcript-message')
                    .length ?? null,
            latencyStreamMs: stats(collect('streamDone')),
            latencyRefineMs: stats(collect('refined')),
            recent: trace.slice(-50)
        };
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
            // 発話の最初の入力デルタ時刻を起点に保持（次の訳出開始までを測る）。
            if (this.latencyTurnStartAt == null) {
                this.latencyTurnStartAt = now;
            }
            return;
        }
        // 訳出の最初のデルタで「入力→訳出」遅延を確定し、次の発話に備えてリセット。
        if (this.latencyTurnStartAt != null) {
            const ms = now - this.latencyTurnStartAt;
            // ✅ D8: 連続ストリームで句がまたがった場合の異常値は表示しない（0〜60秒のみ採用）。
            if (ms >= 0 && ms < 60000) {
                this.updateLatencyDisplay(ms);
            }
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
        // 禁則処理: 行頭(セグメント先頭)に句読点を置かない。サーバが句末句読点を次セグメントの
        //   先頭 delta として送るため、放置すると「。」「、」始まりの確定行ができる。
        this.translationCaption[kind] = this.translationCaption[kind].replace(
            /^[\s、。，．,.!?！？;；:：]+/u,
            ''
        );
        const buffered = this.translationCaption[kind];
        if (!buffered) {
            // 先頭句読点のみを除去して空になった場合は、空のライブ行を作らない。
            return;
        }
        const releasedProtectedHead =
            kind === 'output' ? this.releaseProtectedPendingOutputHeads() : false;
        // ✅ 左右1:1（FIFO）: 訳文は原文より遅れて届くため「入力確定時点のバッファ」をペアに
        //    すると右列が1行ズレる（旧実装の主因）。訳文デルタは「訳文確定待ちの最古の行対」
        //    ＝キュー先頭の右セルへ直接描画する。キューが空（先行訳文/転写OFF）の間のみライブ行。
        if (
            kind === 'output' &&
            this._pendingOutputSegments?.length &&
            typeof this.upsertSegmentOutput === 'function'
        ) {
            this.upsertSegmentOutput(this._pendingOutputSegments[0], buffered, {
                status: 'responding'
            });
        } else {
            if (
                kind === 'output' &&
                releasedProtectedHead &&
                !(this.translationCaption.input || '').trim()
            ) {
                // Chat確定済みの旧行に遅延ストリームが来たケース。ここで孤児行化すると
                // 「新しい訳が下/別行に出る」ように見えるため、入力が始まるまでは描画しない。
                this._dropNextProtectedOutput = true;
            } else {
                this._dropNextProtectedOutput = false;
                // ✅ 増分レンダリング: 確定を待たず、到達デルタを即座にライブ行へ反映する。
                //    （確定時に commitTranslationCaption がライブ行を確定行へ置き換える）
                this.renderLiveCaption(kind, buffered);
            }
        }
        // ✅ BUG1(左右1:1): 確定境界はサーバの session.*_transcript.done に一本化する。
        //    .done が来ない場合の取りこぼし防止としてアイドル確定のみ保険で残す(両列同一規則。
        //    output側はキュー先頭行対の確定+dequeueとして働く＝ターンを跨ぐ累積を防ぐ)。
        this.scheduleTranslationCaptionFlush(kind);
    },

    /**
     * 指定カラムの字幕バッファを1エントリとして確定表示する。
     * アイドルflushタイマーも併せて解除する。
     *
     * @param {'input'|'output'} kind
     */
    commitTranslationCaption(kind, options = {}) {
        if (this.captionFlushTimers && this.captionFlushTimers[kind]) {
            clearTimeout(this.captionFlushTimers[kind]);
            this.captionFlushTimers[kind] = null;
        }
        if (!this.translationCaption) {
            return;
        }
        const text = (this.translationCaption[kind] || '').trim();
        this.translationCaption[kind] = '';
        if (kind === 'input') {
            // ✅ ライブ表示中の暫定行を消し、確定行へ置き換える。
            this.clearLiveCaption(kind);
            if (!text) {
                return;
            }
            this.commitTranslationPair(text);
            return;
        }
        // output の確定（サーバ .done またはアイドルflush）
        this.releaseProtectedPendingOutputHeads();
        if (this._pendingOutputSegments?.length) {
            // ✅ 左右1:1: 訳文確定待ちの最古の行対（キュー先頭）の訳文として確定し、次へ進む。
            //    アイドルflush由来（ターン途中の停滞の可能性がある）は 'stream-final' にせず
            //    'responding' のまま dequeue し、最終確定は路径3(Chat)に委ねる（早期確定の無害化）。
            const segmentId = this._pendingOutputSegments.shift();
            this.clearLiveCaption(kind);
            this.traceTranslation?.('output:finalize', {
                seg: segmentId,
                len: text.length,
                idle: Boolean(options.fromIdle)
            });
            if (text && typeof this.upsertSegmentOutput === 'function') {
                this.upsertSegmentOutput(segmentId, text, {
                    status: options.fromIdle ? 'responding' : 'stream-final'
                });
            }
            // 空（禁則除去で消えた等）なら placeholder を維持し、路径3(Chat確定訳)が埋める。
            return;
        }
        if (this._dropNextProtectedOutput && !this.translationCaption.input) {
            // Chat確定済みの行へ後着した同一ターンのストリーム訳。確定訳を守り、孤児行も作らない。
            this._dropNextProtectedOutput = false;
            this.clearLiveCaption(kind);
            this.traceTranslation?.('output:drop-protected-late', { len: text.length });
            return;
        }
        this._dropNextProtectedOutput = false;
        if (!text) {
            this.clearLiveCaption(kind);
            return;
        }
        if (this.translationCaption.input) {
            // 訳文が入力確定より先に完了したターン: 保留し、直後の入力確定が同一行対として回収する。
            // 回収されない残余は flushTranslationCaptions が必ず排出する（不漏）。
            // ライブ行は残す＝回収まで訳文が画面から消えないようにする。
            if (!this._heldOutputs) {
                this._heldOutputs = [];
            }
            this._heldOutputs.push(text);
            this.traceTranslation?.('output:hold', { len: text.length });
            return;
        }
        this.clearLiveCaption(kind);
        // 入力転写が無い（転写設定OFF・転写失敗）場合の不漏フォールバック: 訳文のみを時系列で確定。
        this.traceTranslation?.('output:orphan', { len: text.length });
        if (typeof this.addTranscript === 'function') {
            this.addTranscript('output', text, null);
        }
    },

    /**
     * 入力確定文を新しい行対（segment）として確定し、訳文確定待ちFIFOへ登録する。
     *
     * 翻訳エンドポイントの transcript ストリームには左右対応キー（item_id等）が無いため、
     * 「一段一翻译」（サーバ .done = 境界、1入力セグメント↔1訳文）を FIFO の順序で対応付ける。
     * 訳文側は handleTranslationTranscriptDelta がキュー先頭の右セルへ描画し、
     * output の .done（commitTranslationCaption）が先頭を確定して次の行対へ進む。
     * 最終的には路径3（Chat 高精度翻訳）が右セルを原文ベースで確定更新する（准）。
     *
     * @param {string} inputText 確定した原文
     */
    commitTranslationPair(inputText) {
        if (!this.segmentAlignment) {
            // アライメント層が無くても表示は落とさない（不漏の底線）: 時系列行で確定する。
            if (typeof this.addTranscript === 'function') {
                this.addTranscript('input', inputText, null);
                const outputText = (this.translationCaption?.output || '').trim();
                if (outputText) {
                    this.translationCaption.output = '';
                    this.clearLiveCaption('output');
                    this.addTranscript('output', outputText, null);
                }
            }
            return;
        }

        const sourceLang =
            this.textPathProcessor?.detectLanguageFromTranscript?.(inputText) || null;
        const created = this.segmentAlignment.createSegment({ sourceLang });
        const segment = this.segmentAlignment.updateInput(created.id, inputText, {
            isFinal: true,
            source: 'translation-stream',
            sourceLang,
            status: 'input-ready'
        });
        this.upsertSegmentInput(segment.id, inputText, { status: 'input-ready' });

        if (this._heldOutputs && this._heldOutputs.length) {
            // 訳文が入力確定より先に完了していたターン: 保留分を本行対の訳文として回収する
            // （既に確定済みの訳文なので FIFO には積まない）。
            const held = this._heldOutputs.shift();
            this.traceTranslation?.('pair:claim-held', { seg: segment.id, len: held.length });
            this.upsertSegmentOutput(segment.id, held, { status: 'stream-final' });
            if (!(this.translationCaption?.output || '').trim()) {
                this.clearLiveCaption('output');
            }
        } else {
            // 訳文確定待ちFIFOへ登録。以後の output デルタ/確定はキュー先頭＝最古の行対へ向かう。
            if (!this._pendingOutputSegments) {
                this._pendingOutputSegments = [];
            }
            // ✅ ズレ有界化: 訳文が一度も来ないターンが先頭に滞留すると以後の右列が恒久的に
            //    1行ズレる。新しい行対を積む時点で待ちが2件以上あれば、最古の先頭は
            //    「訳文なし」とみなして placeholder のまま外す（最終的に路径3が埋める）。
            while (this._pendingOutputSegments.length >= 2) {
                const stale = this._pendingOutputSegments.shift();
                this.traceTranslation?.('pair:stale-dequeue', { seg: stale });
            }
            this._pendingOutputSegments.push(segment.id);
            this.traceTranslation?.('pair:enqueue', {
                seg: segment.id,
                queue: this._pendingOutputSegments.length
            });
            this.upsertSegmentOutput(segment.id, '', {
                status: 'collecting',
                placeholder: '翻訳中...'
            });
            // 本ターンの訳文が先行ストリーミング中（キューが空だった間のライブ行）なら、
            // 本行対の右セルへ移す。バッファは output .done での確定用に残す。
            const buffered = (this.translationCaption?.output || '').trim();
            if (buffered && this._pendingOutputSegments[0] === segment.id) {
                this.upsertSegmentOutput(segment.id, buffered, { status: 'responding' });
                this.clearLiveCaption('output');
            }
        }
        // ✅ 路径3(补精度): Chat 高精度翻訳で同じ行対の右セルを確定更新（デバウンス付き・非ブロッキング）。
        this.refineSegmentTranslation(segment.id, inputText, sourceLang);
    },

    /**
     * Chat確定済みの右行は「旧ターンの終端」とみなし、後続の output ストリームで消費しない。
     * そのまま FIFO 先頭に残すと、次ターンの訳文が旧行を上書きしようとしてから捨てられ、
     * 右列の位置ズレ/消失に見える。
     *
     * @returns {boolean} 先頭を1件以上解放した場合 true
     */
    releaseProtectedPendingOutputHeads() {
        if (!this._pendingOutputSegments || !this._pendingOutputSegments.length) {
            return false;
        }

        let released = false;
        while (this._pendingOutputSegments.length) {
            const segmentId = this._pendingOutputSegments[0];
            const row = this.getTranscriptContainer?.('output')?.querySelector(
                `.transcript-message[data-segment-id="${segmentId}"]`
            );
            const rank = SEGMENT_STATUS_RANK[row?.dataset?.status];
            if (rank == null || rank < SEGMENT_STATUS_RANK.translated) {
                break;
            }
            this._pendingOutputSegments.shift();
            released = true;
            this.traceTranslation?.('pair:release-protected', { seg: segmentId });
        }
        return released;
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
            this.traceTranslation?.('idle-flush', { kind });
            this.commitTranslationCaption(kind, { fromIdle: true });
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
        // input を先に確定する（行対がFIFOへ載り、続く output 確定がその行対を埋める）。
        for (const kind of ['input', 'output']) {
            this.commitTranslationCaption(kind);
        }
        // ✅ 不漏: 入力確定が来ないまま保留された訳文（_heldOutputs 残余）を必ず排出する。
        //    ここで捨てると受信済みの翻訳が黙って消える（切断・session.closed 時の底線）。
        if (
            this._heldOutputs &&
            this._heldOutputs.length &&
            typeof this.addTranscript === 'function'
        ) {
            for (const heldText of this._heldOutputs.splice(0)) {
                this.traceTranslation?.('output:orphan-held', { len: heldText.length });
                this.addTranscript('output', heldText, null);
            }
        }
    },

    /**
     * 翻訳ストリームの表示ペアリング状態を初期化する。
     *
     * 接続/再接続時・トランスクリプトクリア時に呼び、前セッションの残留キュー/バッファが
     * 新しいストリームの行対へ誤って紐づく（削除済みセグメントIDへの描画等）のを防ぐ。
     */
    resetTranslationStreamState() {
        if (this.captionFlushTimers) {
            for (const kind of ['input', 'output']) {
                if (this.captionFlushTimers[kind]) {
                    clearTimeout(this.captionFlushTimers[kind]);
                    this.captionFlushTimers[kind] = null;
                }
            }
        }
        this.translationCaption = { input: '', output: '' };
        this._pendingOutputSegments = [];
        this._heldOutputs = [];
        this._dropNextProtectedOutput = false;
        this.latencyTurnStartAt = null;
        // ✅ ゴースト行防止: 保留中の路径3(refine)デバウンスタイマーも破棄する。
        //    残すとクリア/再接続後に発火し、消去済み segmentId の行を再生成してしまう。
        if (this._segRefineTimers) {
            for (const segmentId of Object.keys(this._segRefineTimers)) {
                clearTimeout(this._segRefineTimers[segmentId]);
            }
            this._segRefineTimers = {};
        }
        if (typeof this.clearLiveCaption === 'function') {
            this.clearLiveCaption('input');
            this.clearLiveCaption('output');
        }
    },

    /**
     * 翻訳セッションを公式手順でクローズする（WebSocket経路のみ）。
     *
     * 公式チェックリスト: session.close を送信し、サーバが残余の翻訳音声・字幕を flush して
     * session.closed を返すまで待ってからソケットを閉じる。即時 close すると
     * ドレイン中の末尾翻訳が失われる。応答が無い場合はタイムアウトで切断を進める。
     *
     * @returns {Promise<void>} session.closed 受信またはタイムアウトで解決
     */
    async closeTranslationSessionGracefully() {
        // 優雅クローズ(session.close→session.closed)は WS ベース翻訳セッションのみ対応
        // （WebRTC は session.closed を受けない／非翻訳セッションは本手順を持たない）。
        if (!this.transport.supportsGracefulClose) {
            return;
        }
        // 切断処理中の失敗は通知しない（既に切れている場合の誤報を避ける）。
        const sent = await this.sendMessage({ type: 'session.close' }, { silentFailure: true });
        if (!sent) {
            return;
        }
        await new Promise((resolve) => {
            const timer = setTimeout(() => {
                this._sessionClosedWaiter = null;
                resolve();
            }, TRANSLATION_CLOSE_TIMEOUT_MS);
            this._sessionClosedWaiter = () => {
                clearTimeout(timer);
                this._sessionClosedWaiter = null;
                resolve();
            };
        });
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
        // 翻訳専用セッションではセグメント消費者が無く、grouped の createSegment も
        // 残骸 placeholder 行になるだけのため蓄積しない（tryEnqueueAudioSegment と同じ理由）。
        if (this.isRealtimeTranslationSession()) {
            return;
        }
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
        const sampleRate = CONFIG.AUDIO.SAMPLE_RATE; // 入力は境界で24kへリサンプル済み（ctxはネイティブ）
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
            const sampleRate = CONFIG.AUDIO.SAMPLE_RATE; // 入力は境界で24kへリサンプル済み（ctxはネイティブ）
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
            const sampleRate = CONFIG.AUDIO.SAMPLE_RATE; // 入力は境界で24kへリサンプル済み（ctxはネイティブ）
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
        // 翻訳専用セッションでは双パス消費者が全て skip するため、セグメント enqueue は
        // 「認識中...」placeholder の残骸行を作るだけになる。字幕は session.*_transcript が担う。
        if (this.isRealtimeTranslationSession()) {
            return false;
        }

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
        if (!message.transcript) {
            return;
        }
        // Path1 の音声再送で発生する転写は二重処理になるため無視する。
        if (!this.useAudioQueue || !this.segmentAlignment || this.segmentResendDepth) {
            return;
        }

        // ✅ 路径1(识别) は grouped の flush 状態から完全に独立して左カラムを確定描画する。
        //    描画先 segment は「item_id で束ねた segment」を第一に解決する。これは
        //    flushGroupedAudio() が groupedSegmentId を null 化した後でも生存するため、
        //    MAX_SENTENCES 等の音声区切り設定を変えても認識表示は一切影響を受けない（不漏）。
        //    解決順: ①item_idバインド済み → ②収集中グループへ今バインド → ③FIFO確定(fallback)。
        let segment = this.segmentAlignment.getSegmentByItemId(message.item_id);
        if (!segment && this.groupedSegmentId) {
            // 収集中グループへ item_id を束ねる（以後の遅延 completed も同 segment へ戻る）。
            this.segmentAlignment.bindItemId(message.item_id, this.groupedSegmentId);
            segment = this.segmentAlignment.getSegment(this.groupedSegmentId);
        }
        if (segment) {
            const nextText = this.joinSegmentTranscriptText(segment.input.text, message.transcript);
            segment = this.segmentAlignment.updateInput(segment.id, nextText, {
                isFinal: true,
                source: 'live-sra',
                sourceLang: this.textPathProcessor?.detectLanguageFromTranscript?.(nextText)
            });
        } else {
            // グループ未収集/未バインド → FIFO 先頭を確定（従来 fallback）。
            segment = this.segmentAlignment.completeNextInput(message.transcript, {
                source: 'live-sra',
                sourceLang: this.textPathProcessor?.detectLanguageFromTranscript?.(
                    message.transcript
                )
            });
        }
        if (segment) {
            this.upsertSegmentInput(segment.id, segment.input.text, {
                status: 'input-ready'
            });
            this.upsertSegmentOutput(segment.id, segment.output.text, {
                status: segment.output.responseId ? 'responding' : 'collecting',
                placeholder: '翻訳待機中...'
            });
            // ✅ 路径3(补精度): 認識確定文を Chat(高精度)で翻訳し、同 segment の右カラムへ確定描画する。
            //    左右は segmentId で 1:1（补齐左右一致）＝欠落を作らない（不漏）。非同期・非ブロッキング。
            this.refineSegmentTranslation(segment.id, segment.input.text, segment.input.sourceLang);
        }

        // ✅ 音声経路(路径2)の区切り判定にのみ文数を渡す（表示には一切影響しない）。
        //    描画は既に済んでいるため、この後 flush が groupedSegmentId を null 化しても取りこぼさない。
        if (this.isGroupedTurnMode()) {
            this.addGroupedSentenceCount(message.transcript);
        }
    },

    /**
     * 路径3(补精度): 認識確定文を Chat 翻訳し、同 segment の右カラムを確定描画する。
     *
     * grouped の1 segment は複数 completed を集約するため、最終テキストで1回だけ翻訳するよう
     * segmentId 単位でデバウンスする（重複翻訳・途中翻訳を避ける）。非同期・非ブロッキングで、
     * 実時表示（左認識・音声）を一切止めない。失敗時は placeholder を維持（不漏の底線）。
     *
     * @param {string} segmentId 左右対応の安定キー
     * @param {string} text 認識確定文（原文）
     * @param {string} [sourceLang] 検出済みソース言語（無ければ auto）
     */
    refineSegmentTranslation(segmentId, text, sourceLang) {
        if (!segmentId || !text || !text.trim()) {
            return;
        }
        if (!this._segRefineTimers) {
            this._segRefineTimers = {};
        }
        if (this._segRefineTimers[segmentId]) {
            clearTimeout(this._segRefineTimers[segmentId]);
        }
        // ponytail: 250ms デバウンス。複数 completed を最終文でまとめて1回だけ翻訳する
        // （確定訳の体感遅延を下げるため 500→250ms。連投抑止の効果は維持）。
        this._segRefineTimers[segmentId] = setTimeout(() => {
            delete this._segRefineTimers[segmentId];
            this.translateSegmentViaChat(segmentId, text, sourceLang);
        }, 250);
    },

    /**
     * Chat Completions で1文を翻訳し、右カラムの segment 行へ in-place 反映する。
     * 表示・音声を止めない後追い処理。API 失敗時は placeholder を維持して表示を消さない。
     *
     * @param {string} segmentId
     * @param {string} text 原文
     * @param {string} [sourceLang]
     * @returns {Promise<void>}
     */
    async translateSegmentViaChat(segmentId, text, sourceLang) {
        try {
            if (!this.state.apiKey || typeof fetch !== 'function') {
                // 補精度が走れない場合はストリーム訳のまま確定扱いにする（'responding' 放置を防ぐ）。
                this.setSegmentOutputStatus?.(segmentId, 'stream-final');
                return;
            }
            const targetLangName = Utils.getLanguageName(this.state.targetLang || 'ja');
            const srcPrompt =
                sourceLang && sourceLang !== 'auto'
                    ? `from ${Utils.getLanguageName(sourceLang)} `
                    : '';
            const model = CONFIG.API.CHAT_MODEL;
            const body = {
                model,
                messages: [
                    {
                        role: 'system',
                        content: `You are a professional simultaneous interpreter. Translate the user's text ${srcPrompt}to ${targetLangName}. Output ONLY the translation, no explanations, no commentary.`
                    },
                    { role: 'user', content: text }
                ],
                max_completion_tokens: 500
            };
            if (!String(model).startsWith('gpt-5')) {
                body.temperature = 0;
            }
            const res = await fetch(CONFIG.API.CHAT_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${this.state.apiKey}`
                },
                body: JSON.stringify(body)
            });
            if (!res.ok) {
                // 失敗時はテキストを消さず（不漏）、ストリーム訳のまま確定状態へ落とす。
                this.setSegmentOutputStatus?.(segmentId, 'stream-final');
                return;
            }
            const data = await res.json();
            const raw = data?.choices?.[0]?.message?.content || '';
            const translated = (
                (Utils.stripAssistantBoilerplate ? Utils.stripAssistantBoilerplate(raw) : raw) || ''
            ).trim();
            if (translated && typeof this.upsertSegmentOutput === 'function') {
                // クリア/再接続で行が消えている場合は適用しない（ゴースト行の再生成防止）。
                const row = this.getTranscriptContainer?.('output')?.querySelector(
                    `.transcript-message[data-segment-id="${segmentId}"]`
                );
                if (!row) {
                    this.traceTranslation?.('refine:stale-drop', { seg: segmentId });
                    return;
                }
                this.upsertSegmentOutput(segmentId, translated, { status: 'translated' });
                this.traceTranslation?.('refine:apply', { seg: segmentId });
            } else {
                this.setSegmentOutputStatus?.(segmentId, 'stream-final');
            }
        } catch (error) {
            // ネットワーク/API エラー: テキストは消さず（不漏の底線）、確定状態へ落とす。
            this.setSegmentOutputStatus?.(segmentId, 'stream-final');
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
        // ✅ PCM append を受けない経路（WebRTC はメディアトラックで音声送信）では送らない。
        if (this.transport.audioInput !== 'pcm-event') {
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
        // 判定はキャプチャプロファイル（voicetranslate-capture-profile.js の決定表）に集約:
        //   duplex='full'          … 仮想カード/ループバック/タブ共有（デジタル隔離経路）。
        //                             再生中も送信し続ける（半二重にしない＝文落ちを絶対に防ぐ）。
        //                             回灌リスクは ttsPolicy（TTS抑止）側で断つ。
        //   duplex='mic-protected' … 物理マイク。再生中＋再生終了後 bufferWindow 内はスキップ
        //                             （スピーカー→マイク伝播エコーの再入力防止。エコー自体は
        //                             getUserMedia の echoCancellation でも抑制する）。
        // ★UI選択値(audioSourceType)や出力先設定を直接参照しない。フォールバックで実効
        //   デバイスが変わっても、プロファイル経由で判定が必ず追随する。
        const shouldSkip = shouldSkipCapture(this.captureProfile, {
            isPlayingAudio: this.state.isPlayingAudio,
            outputEndTime: this.audioSourceTracker.outputEndTime,
            bufferWindowMs: this.audioSourceTracker.bufferWindow,
            now: Date.now()
        });

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

        // 統計は同期で計上する（Path1 の「追記→同一ティック内 commit」があるため遅延不可）。
        // 送信失敗が判明したら取り消す（失敗フレームを「送信済み」に数えたままだと
        // commit 判定が実在しない音声を commit してしまう）。ホットパスのため await はしない。
        this.recordRealtimeInputAudioAppend(audioData);
        this.sendMessage(message).then((sent) => {
            if (!sent && this.realtimeInputAudioBufferStats) {
                // commit/reset 済みなら 0 でクランプされるだけ（新しい計上期間は壊さない）
                this.realtimeInputAudioBufferStats.samples = Math.max(
                    0,
                    this.realtimeInputAudioBufferStats.samples - (audioData?.length || 0)
                );
                this.realtimeInputAudioBufferStats.chunks = Math.max(
                    0,
                    this.realtimeInputAudioBufferStats.chunks - 1
                );
            }
        });
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
        if (!base64Audio || typeof base64Audio !== 'string') {
            return;
        }
        // ✅ 音声出力OFF、またはループバック監視中（回灌防止の自動ミュート）は再生しない。
        //    単一の真実源 state.audioOutputMode を直接見るため、トグル不整合で無音化しない。
        if (this.state.audioOutputMode !== 'translation' || this._ttsSuppressedByLoopback) {
            return;
        }
        // ✅ 順序保証＋出力Context初期化レース回避のためスケジューリングを直列化する。
        //    予約は currentTime ベースの先読みなので、直列でもギャップは生じない。
        this._playbackChain = (this._playbackChain || Promise.resolve())
            .then(() => this.scheduleAudioChunk(base64Audio))
            .catch((error) => this.handleAudioPlaybackError(error));
    },

    /**
     * ✅ ギャップレス再生（D6）: PCM16チャンクを直前チャンクの終了時刻へ隙間なく予約する。
     *
     * 目的:
     *   従来は「前チャンクの onended 後にデコードして再生」していたため、チャンク毎に
     *   デコード分の無音が入り訳音がブツ切れになっていた。ここでは
     *   PCM16→AudioBuffer 直書き（同期・低遅延）＋ 連結カーソル _nextPlaybackTime での
     *   先読み予約により、隙間のない連続再生にする。
     *
     * @param {string} base64Audio base64 PCM16(24kHz mono)
     */
    async scheduleAudioChunk(base64Audio) {
        await this.initializeOutputAudioContext();
        const ctx = this.state.outputAudioContext;
        if (!ctx) {
            return;
        }

        const buffer = this.pcm16ToAudioBuffer(base64Audio, ctx);
        if (!buffer || buffer.length === 0) {
            return;
        }

        const gainNode = ctx.createGain();
        gainNode.gain.value = this.state.outputVolume;
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(gainNode);
        gainNode.connect(ctx.destination);

        // 直前チャンクの終了時刻へ連結。新しい再生バースト/アンダーラン時のみ先頭にリードを入れ、
        // 後続チャンクの到着猶予（ジッタ吸収）を作る。バースト内は _nextPlaybackTime で隙間なく連結。
        // ponytail: 120msリード。短い→磕巴(underrun), 長い→遅延。実測で調整可。
        const PLAYBACK_LEAD_SEC = 0.12;
        const startAt =
            !this._nextPlaybackTime || this._nextPlaybackTime <= ctx.currentTime
                ? ctx.currentTime + PLAYBACK_LEAD_SEC
                : this._nextPlaybackTime;
        source.start(startAt);
        this._nextPlaybackTime = startAt + buffer.duration;

        // ループバック防止トラッキング＆入力ミュート（再生中）。
        this.state.isPlayingAudio = true;
        this.audioSourceTracker.outputStartTime = Date.now();
        if (this.state.inputGainNode) {
            this.state.inputGainNode.gain.value = 0;
        }

        if (!this._activeSources) {
            this._activeSources = new Set();
        }
        this._activeSources.add(source);
        this.currentAudioSource = source;

        source.onended = () => {
            try {
                source.disconnect();
                gainNode.disconnect();
            } catch (cleanupError) {
                // 解放処理の失敗は無害なため無視
            }
            this._activeSources.delete(source);
            // 予約済みが全て鳴り終わったら再生終了として扱う（バッファウィンドウ計算用）。
            if (this._activeSources.size === 0) {
                this.audioSourceTracker.outputEndTime = Date.now();
                this.handleAudioPlaybackEnded();
            }
        };
    },

    /**
     * ✅ PCM16(24kHz mono) を AudioBuffer へ直書きする（同期・低遅延。WAV化/decode を排除）。
     *
     * @param {string} base64Audio base64 PCM16
     * @param {AudioContext} ctx 出力 AudioContext
     * @returns {AudioBuffer|null} 空データのときは null
     */
    pcm16ToAudioBuffer(base64Audio, ctx) {
        const pcm = Utils.base64ToArrayBuffer(base64Audio);
        const int16 = new Int16Array(pcm);
        if (int16.length === 0) {
            return null;
        }
        const float32 = new Float32Array(int16.length);
        for (let i = 0; i < int16.length; i++) {
            float32[i] = int16[i] / 32768;
        }
        const buffer = ctx.createBuffer(1, float32.length, CONFIG.AUDIO.SAMPLE_RATE);
        buffer.copyToChannel(float32, 0);
        return buffer;
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
            // 翻訳音声を物理スピーカー/ヘッドホンへ固定（既定出力が仮想カードでも聞こえるように）
            // applyOutputSink は pro.js 側の実体。mixin 単体適用(テスト等)では未定義のため guard する。
            if (typeof this.applyOutputSink === 'function') {
                await this.applyOutputSink(this.state.outputAudioContext);
            }
        }

        // AudioContextがsuspended状態の場合はresume
        if (this.state.outputAudioContext.state === 'suspended') {
            await this.state.outputAudioContext.resume();
        }
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
        // ✅ 予約済みの全チャンクが鳴り終わった。再生中フラグと連結カーソルを解除する。
        this.state.isPlayingAudio = false;
        this._nextPlaybackTime = 0;
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
        this._nextPlaybackTime = 0;

        // 入力音声は常にミュート維持
        if (this.state.inputGainNode) {
            this.state.inputGainNode.gain.value = 0;
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
