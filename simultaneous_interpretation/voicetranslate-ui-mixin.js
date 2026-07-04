/**
 * VoiceTranslate Pro 2.0 - UI Management Mixin
 *
 * 目的:
 *   UI更新、転録表示、ビジュアライザー管理を分離
 *   メインクラスの複雑度を軽減し、保守性を向上
 *
 * 依存:
 *   - voicetranslate-utils.js: CONFIG, AudioUtils
 *
 * 使用方法:
 *   Object.assign(VoiceTranslateApp.prototype, UIMixin);
 */

const UIMixin = {
    /**
     * 重複するトランスクリプトをチェック
     * 目的: 同じtranscriptIdとtypeで既に表示されている場合を検出
     *
     * @param {string} type - トランスクリプトタイプ
     * @param {number} transcriptId - トランスクリプトID
     * @param {string} text - テキスト（ログ用）
     * @returns {Element|null} 既存要素またはnull
     */
    checkDuplicateTranscript(type, transcriptId, text) {
        if (!transcriptId || type !== 'output') {
            return null;
        }

        const container = this.elements.outputTranscript;
        if (!container) {
            return null;
        }

        const existing = container.querySelector(`[data-transcript-id="${transcriptId}"]`);
        if (existing) {
        }
        return existing;
    },

    /**
     * トランスクリプト表示可否をチェック
     * 目的: ユーザー設定に基づいて表示/非表示を判定
     *
     * @param {string} type - トランスクリプトタイプ
     * @returns {boolean} 表示すべき場合true
     */
    shouldShowTranscript(type) {
        const showInput = this.elements.showInputTranscript?.classList.contains('active') ?? true;
        const showOutput = this.elements.showOutputTranscript?.classList.contains('active') ?? true;

        if (type === 'input' && !showInput) {
            return false;
        }

        if (type === 'output' && !showOutput) {
            return false;
        }

        return true;
    },

    /**
     * トランスクリプトコンテナを取得
     * 目的: タイプに応じた適切なコンテナを返す
     *
     * @param {string} type - トランスクリプトタイプ
     * @returns {Element|null} コンテナ要素またはnull
     */
    getTranscriptContainer(type) {
        const container =
            type === 'input' ? this.elements.inputTranscript : this.elements.outputTranscript;

        if (!container) {
            return null;
        }

        return container;
    },

    /**
     * メッセージ要素を作成
     * 目的: トランスクリプト表示用のDOM要素を生成
     *
     * @param {string} type - トランスクリプトタイプ
     * @param {string} text - メッセージテキスト
     * @param {number} transcriptId - トランスクリプトID
     * @returns {Element} 作成されたメッセージ要素
     */
    createTranscriptMessage(type, text, transcriptId) {
        const message = document.createElement('div');
        message.className = `transcript-message ${type === 'output' ? 'translation' : ''}`;

        if (transcriptId) {
            message.dataset.transcriptId = transcriptId;
        }

        const time = document.createElement('div');
        time.className = 'transcript-time';
        time.textContent = new Date().toLocaleTimeString('ja-JP');

        const content = document.createElement('div');
        content.className = 'transcript-text';
        content.textContent = text;

        message.appendChild(time);
        message.appendChild(content);

        return message;
    },

    /**
     * セグメント単位でトランスクリプトDOMを作成/更新する。
     * STSモードでは input/output/audio を同じ segmentId に結びつける。
     *
     * @param {string} type - 'input' または 'output'
     * @param {string} segmentId - 安定したセグメントID
     * @param {string} text - 表示テキスト
     * @param {Object} options - 表示状態
     * @returns {Element|null}
     */
    upsertSegmentTranscript(type, segmentId, text, options = {}) {
        if (!segmentId) {
            return this.addTranscript(type, text, null);
        }

        if (!this.shouldShowTranscript(type)) {
            return null;
        }

        const container = this.getTranscriptContainer(type);
        if (!container) {
            return null;
        }

        this.removeEmptyState(container);

        const selector = `.transcript-message[data-segment-id="${segmentId}"]`;
        let message = container.querySelector(selector);

        if (!message) {
            // 作成順シーケンス（seq）で並べる。左右カラムとも同じ seq を使うため順序が必ず一致する。
            const seq = this.segmentAlignment?.getSegment?.(segmentId)?.seq ?? null;
            message = this.createTranscriptMessage(type, text || options.placeholder || '', null);
            message.dataset.segmentId = segmentId;
            message.dataset.transcriptId = segmentId;
            if (seq != null) {
                message.dataset.seq = String(seq);
            }
            if (options.responseId) {
                message.dataset.responseId = options.responseId;
            }
            this.insertSegmentMessage(container, message, seq);
        }

        if (options.responseId) {
            message.dataset.responseId = options.responseId;
        }
        if (options.status) {
            message.dataset.status = options.status;
        }

        const textElement = message.querySelector('.transcript-text');
        if (textElement) {
            textElement.textContent = text || options.placeholder || '';
        }

        container.scrollTop = 0;
        return message;
    },

    /**
     * 作成順シーケンス（seq）の降順で挿入する（新しい=seq が大きいものを上）。
     * 文字列比較ではなく数値比較なので、segmentId のタイムスタンプ桁揃えに依存しない。
     *
     * @param {Element} container
     * @param {Element} message
     * @param {number|null} seq - segment の作成順シーケンス
     */
    insertSegmentMessage(container, message, seq) {
        const newSeq = Number(seq);
        let insertPosition = null;
        if (Number.isFinite(newSeq)) {
            const messages = container.querySelectorAll('.transcript-message[data-segment-id]');
            for (const msg of messages) {
                const existingSeq = Number(msg.dataset.seq);
                if (Number.isFinite(existingSeq) && newSeq > existingSeq) {
                    insertPosition = msg;
                    break;
                }
            }
        }

        if (insertPosition) {
            insertPosition.before(message);
        } else {
            container.appendChild(message);
        }
    },

    upsertSegmentInput(segmentId, text, options = {}) {
        return this.upsertSegmentTranscript('input', segmentId, text, options);
    },

    upsertSegmentOutput(segmentId, text, options = {}) {
        return this.upsertSegmentTranscript('output', segmentId, text, {
            placeholder: '翻訳中...',
            ...options
        });
    },

    /**
     * 右カラム行の status だけを変更する（テキストには触れない）。
     * 路径3(Chat確定訳)の失敗時に 'responding' 放置を解消する用途。
     *
     * @param {string} segmentId
     * @param {string} status
     */
    setSegmentOutputStatus(segmentId, status) {
        if (!segmentId || !status) {
            return;
        }
        const container = this.getTranscriptContainer('output');
        const message = container?.querySelector(
            `.transcript-message[data-segment-id="${segmentId}"]`
        );
        if (message) {
            message.dataset.status = status;
        }
    },

    /**
     * 空状態要素を削除
     * 目的: 最初のメッセージ追加時に空状態表示を削除
     *
     * @param {Element} container - コンテナ要素
     */
    removeEmptyState(container) {
        const emptyState = container.querySelector('.empty-state');
        if (emptyState) {
            emptyState.remove();
        }
    },

    /**
     * 順序付きメッセージを挿入（output用）
     * 目的: transcriptIdの順序を保証して正しい位置に挿入
     *
     * @param {Element} container - コンテナ要素
     * @param {Element} message - メッセージ要素
     * @param {number} transcriptId - トランスクリプトID
     */
    insertOrderedMessage(container, message, transcriptId) {
        let insertPosition = null;
        const messages = container.querySelectorAll('.transcript-message');

        for (const msg of messages) {
            const existingId = Number.parseInt(msg.dataset.transcriptId, 10);
            if (existingId && transcriptId > existingId) {
                insertPosition = msg;
                break;
            }
        }

        if (insertPosition) {
            insertPosition.before(message);
        } else {
            container.appendChild(message);
        }
    },

    /**
     * 最新メッセージを最上部に追加
     * 目的: input型またはtranscriptIdなしの場合の標準的な挿入
     *
     * @param {Element} container - コンテナ要素
     * @param {Element} message - メッセージ要素
     * @param {string} type - トランスクリプトタイプ
     * @param {number} transcriptId - トランスクリプトID
     */
    insertLatestMessage(container, message, type, transcriptId) {
        if (container.firstChild) {
            container.insertBefore(message, container.firstChild);
        } else {
            container.appendChild(message);
        }
    },

    /**
     * トランスクリプトにテキストを追加
     *
     * 目的:
     *   入力音声または翻訳結果にテキストを追加し、最新のメッセージが上に表示されるようにする
     *
     * @param {string} type - 'input' または 'output' または 'text-translation'
     * @param {string} text - 追加するテキスト
     * @param {number} transcriptId - トランスクリプトID（一対一対応用）
     */
    addTranscript(type, text, transcriptId = null) {
        // 重複チェック
        const duplicate = this.checkDuplicateTranscript(type, transcriptId, text);
        if (duplicate) {
            return duplicate;
        }

        // 表示可否チェック
        if (!this.shouldShowTranscript(type)) {
            // ✅ 表示しない場合でもデータベースには保存
            this.saveTranscriptToDatabase(type, text, transcriptId);
            return;
        }

        // コンテナ取得
        const container = this.getTranscriptContainer(type);
        if (!container) {
            return;
        }

        // 空状態を削除
        this.removeEmptyState(container);

        // メッセージ要素を作成
        const message = this.createTranscriptMessage(type, text, transcriptId);

        // メッセージを挿入
        if (type === 'output' && transcriptId) {
            this.insertOrderedMessage(container, message, transcriptId);
        } else {
            this.insertLatestMessage(container, message, type, transcriptId);
        }

        // 一番上にスクロール（最新のメッセージが見えるように）
        container.scrollTop = 0;

        // 文字数カウント更新
        this.state.charCount += text.length;
        if (this.elements.charCount) {
            this.elements.charCount.textContent = this.state.charCount.toLocaleString();
        }

        // ✅ Electron環境: データベースに保存
        this.saveTranscriptToDatabase(type, text, transcriptId);

        return message;
    },

    /**
     * 翻訳セッションのライブ字幕（暫定行）を作成/更新する。
     *
     * 目的:
     *   確定（句末/アイドル）を待たず、到達したデルタを即座に1本の暫定行へ
     *   反映し、滑らかな実時間表示にする。確定時は clearLiveCaption() で暫定行を
     *   消し、addTranscript() が確定行を正式に追加する（確定行の挙動は不変）。
     *
     * @param {'input'|'output'} kind input=原文(左) / output=訳文(右)
     * @param {string} text これまでに累積した暫定テキスト
     */
    renderLiveCaption(kind, text) {
        if (!this.shouldShowTranscript(kind)) {
            return;
        }
        const container = this.getTranscriptContainer(kind);
        if (!container) {
            return;
        }
        this.removeEmptyState(container);

        if (!this.liveCaptionEl) {
            this.liveCaptionEl = { input: null, output: null };
        }

        let el = this.liveCaptionEl[kind];
        if (!el || !el.isConnected) {
            el = this.createTranscriptMessage(kind, text, null);
            el.dataset.live = '1';
            container.insertBefore(el, container.firstChild);
            this.liveCaptionEl[kind] = el;
        } else {
            const textElement = el.querySelector('.transcript-text');
            if (textElement) {
                textElement.textContent = text;
            }
        }

        container.scrollTop = 0;
    },

    /**
     * ライブ字幕（暫定行）を除去する。確定行を addTranscript() で追加する直前に呼ぶ。
     *
     * @param {'input'|'output'} kind
     */
    clearLiveCaption(kind) {
        if (!this.liveCaptionEl) {
            return;
        }
        const el = this.liveCaptionEl[kind];
        if (el && el.isConnected) {
            el.remove();
        }
        this.liveCaptionEl[kind] = null;
    },

    /**
     * トランスクリプトをデータベースに保存
     *
     * 目的:
     *   Electron環境でのみ、会話履歴をSQLiteデータベースに保存
     *   音声入力（input）のみ保存、音声出力（output）は保存しない
     *
     * @param {string} type - 'input' または 'output'
     * @param {string} text - テキスト
     * @param {number} transcriptId - トランスクリプトID
     */
    async saveTranscriptToDatabase(type, text, transcriptId) {
        // ✅ 音声入力のみ保存（音声出力は保存しない）
        if (type !== 'input') {
            return;
        }

        // 会話保存(SQLite)はElectronのみ対応
        if (!this.platform.conversation) {
            return;
        }

        // セッションIDチェック
        if (!this.state.currentSessionId) {
            return;
        }

        try {
            // ✅ 音声入力として保存（role = user）
            const role = 'user';

            // 言語情報取得
            const language = this.state.sourceLang || 'auto';

            // ターン追加
            await this.platform.conversation.addTurn({
                role: role,
                content: text,
                language: language,
                timestamp: transcriptId || Date.now()
            });
        } catch (error) {
            // 履歴保存(SQLite)の失敗は翻訳継続には致命的でないが、無言で履歴を
            // 失わないよう、セッション中に一度だけ警告する（毎ターン通知の氾濫は避ける）。
            if (!this._historySaveWarned) {
                this._historySaveWarned = true;
                const detail = error && error.message ? error.message : String(error);
                this.notify(
                    '履歴保存の警告',
                    '会話履歴の保存に失敗しました（翻訳は継続します）: ' + detail,
                    'warning'
                );
            }
        }
    },

    /**
     * トランスクリプトに追記
     *
     * 目的:
     *   最新のメッセージにテキストを追記する（ストリーミング用）
     *
     * @param {string} type - 'input' または 'output'
     * @param {string} text - 追加するテキスト
     */
    appendTranscript(type, text) {
        const container =
            type === 'input' ? this.elements.inputTranscript : this.elements.outputTranscript;

        if (!container) {
            return;
        }

        // 最新のメッセージ（一番上）のテキスト部分を取得
        const firstMessage = container.querySelector('.transcript-message:first-child');
        if (firstMessage) {
            // テキスト部分を取得（.transcript-text または最後の div）
            const textElement =
                firstMessage.querySelector('.transcript-text') ||
                firstMessage.querySelector('div:last-child');

            if (textElement && !textElement.classList.contains('transcript-time')) {
                textElement.textContent += text;
            } else {
                this.addTranscript(type, text);
            }
        } else {
            this.addTranscript(type, text);
        }

        // 一番上にスクロール（最新のメッセージが見えるように）
        container.scrollTop = 0;

        // 文字数カウント更新
        this.state.charCount += text.length;
        if (this.elements.charCount) {
            this.elements.charCount.textContent = this.state.charCount.toLocaleString();
        }
    },

    /**
     * トランスクリプトをクリア
     *
     * 目的:
     *   入力音声と翻訳結果の表示をクリアする
     *
     * @param {string} type - 'input', 'output', または 'both'（両方）
     */
    clearTranscript(type = 'both') {
        // 要素が初期化されているか確認
        if (!this.elements || !this.elements.inputTranscript || !this.elements.outputTranscript) {
            return;
        }

        // 翻訳ストリームのペアリング状態も破棄する。残すと訳文確定待ちキューが
        // 削除済みセグメントIDを指し、以後の訳文が存在しない行へ描画される。
        this.resetTranslationStreamState?.();

        const clearContainer = (containerType) => {
            const container =
                containerType === 'input'
                    ? this.elements.inputTranscript
                    : this.elements.outputTranscript;

            if (!container) {
                return;
            }

            // すべてのメッセージを削除
            container.innerHTML = '';

            // 空状態を表示
            const emptyState = document.createElement('div');
            emptyState.className = 'empty-state';

            const icon = document.createElement('div');
            icon.className = 'empty-icon';
            icon.textContent = containerType === 'input' ? '🎤' : '🌐';

            const text = document.createElement('div');
            text.className = 'empty-text';
            text.textContent =
                containerType === 'input'
                    ? '録音を開始すると、ここに音声認識結果が表示されます'
                    : '翻訳結果がここに表示されます';

            emptyState.appendChild(icon);
            emptyState.appendChild(text);
            container.appendChild(emptyState);
        };

        if (type === 'both') {
            clearContainer('input');
            clearContainer('output');
        } else {
            clearContainer(type);
        }

        // 文字数カウントをリセット
        this.state.charCount = 0;
        if (this.elements.charCount) {
            this.elements.charCount.textContent = '0';
        }

        if (type === 'both' && this.segmentAlignment) {
            this.segmentAlignment.clear();
        }

        this.notify('クリア完了', 'トランスクリプトをクリアしました', 'success');
    },

    /**
     * ビジュアライザー更新
     *
     * 目的:
     *   音声レベルに応じてビジュアライザーのバーを更新
     *
     * @param {Float32Array} audioData - 音声データ
     * @param {Object} vadResult - VAD解析結果
     */
    updateVisualizer(audioData, vadResult = null) {
        const average = audioData.reduce((sum, val) => sum + Math.abs(val), 0) / audioData.length;
        const normalizedLevel = Math.min(1, average * 10);

        this.visualizerBars.forEach((bar, _index) => {
            const randomFactor = 0.7 + Math.random() * 0.3;
            const height = Math.max(20, normalizedLevel * 80 * randomFactor);
            bar.style.height = `${height}%`;

            if (vadResult && vadResult.isSpeaking) {
                bar.classList.add('active');
            } else {
                bar.classList.remove('active');
            }
        });
    },

    /**
     * ビジュアライザーリセット
     *
     * 目的:
     *   ビジュアライザーを初期状態に戻す
     */
    resetVisualizer() {
        this.visualizerBars.forEach((bar) => {
            bar.style.height = '20%';
            bar.classList.remove('active');
        });
    },

    /**
     * 接続ステータス更新
     *
     * 目的:
     *   WebSocket接続状態を視覚的に表示
     *
     * @param {string} status - 接続状態 ('connecting', 'connected', 'error', 'offline')
     */
    updateConnectionStatus(status) {
        const statusDot = this.elements.connectionStatus;
        const statusText = this.elements.connectionText;

        statusDot.className = 'status-dot';

        switch (status) {
            case 'connecting':
                statusDot.classList.add('connecting');
                statusText.textContent = '接続中...';
                break;
            case 'connected':
                statusDot.classList.add('online');
                statusText.textContent = 'オンライン';
                break;
            case 'error':
                statusDot.classList.add('error');
                statusText.textContent = 'エラー';
                break;
            default:
                statusText.textContent = 'オフライン';
        }
    },

    /**
     * ステータス更新
     *
     * 目的:
     *   アプリケーションの状態をログに記録
     *
     * @param {string} type - ステータスタイプ
     * @param {string} text - ステータステキスト
     */
    updateStatus(type, text) {},

    /**
     * 通知表示
     *
     * 目的:
     *   ユーザーに通知メッセージを表示
     *
     * @param {string} title - 通知タイトル
     * @param {string} message - 通知メッセージ
     * @param {string} type - 通知タイプ ('info', 'success', 'warning', 'error')
     */
    notify(title, message, type = 'info') {
        const notification = this.elements.notification;
        const titleEl = this.elements.notificationTitle;
        const messageEl = this.elements.notificationMessage;

        titleEl.textContent = title;
        messageEl.textContent = message;

        notification.className = `notification ${type}`;
        notification.classList.add('show');

        setTimeout(() => {
            notification.classList.remove('show');
        }, 4000);
    },

    /**
     * レイテンシー表示更新
     *
     * 目的:
     *   音声処理の統計情報を表示
     *
     * @param {Object} stats - 統計情報
     */
    updateLatencyDisplay(latencyMs) {
        // 観測値(ms)のみ表示。旧経路は stats オブジェクトを渡すため、数値以外は無視する。
        if (typeof latencyMs !== 'number' || !isFinite(latencyMs) || latencyMs < 0) {
            return;
        }
        if (this.elements.latency) {
            this.elements.latency.textContent = `${Math.round(latencyMs)} ms`;
        }
    },

    /**
     * 精度表示更新
     *
     * 目的:
     *   音声認識の精度を表示
     */
    updateAccuracy() {
        // 精度(正解率)は基準訳が無く、S2ST ストリームに confidence/logprob も無いため
        // 実値を算出できない。乱数の偽装はせず、プレースホルダ表示に留める。
        if (this.elements.accuracy) {
            this.elements.accuracy.textContent = '実装中';
        }
    }
};

// voicetranslate-pro.js で使用されるため、エクスポート
const _UIMixin = UIMixin;
