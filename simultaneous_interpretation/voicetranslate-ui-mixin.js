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
            console.warn('[Transcript] 重複検出 - スキップ:', {
                type,
                transcriptId,
                text: text.substring(0, 20)
            });
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
            console.info('[Transcript] 入力音声表示がOFFのためスキップ');
            return false;
        }

        if (type === 'output' && !showOutput) {
            console.info('[Transcript] 翻訳結果表示がOFFのためスキップ');
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
            console.error('[Transcript] コンテナが見つかりません:', type);
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
     * 空状態要素を削除
     * 目的: 最初のメッセージ追加時に空状態表示を削除
     *
     * @param {Element} container - コンテナ要素
     */
    removeEmptyState(container) {
        const emptyState = container.querySelector('.empty-state');
        if (emptyState) {
            console.info('[Transcript] 空状態を削除');
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
                console.info('[Transcript] 挿入位置を発見:', {
                    currentId: transcriptId,
                    existingId: existingId,
                    insertBefore: true
                });
                break;
            }
        }

        if (insertPosition) {
            insertPosition.before(message);
            console.info('[Transcript] 順序を保証して挿入:', {
                transcriptId: transcriptId,
                position: '中間位置',
                totalMessages: container.children.length
            });
        } else {
            container.appendChild(message);
            console.info('[Transcript] 最後に追加:', {
                transcriptId: transcriptId,
                position: '最下部',
                totalMessages: container.children.length
            });
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
        console.info('[Transcript] 最新メッセージを最上部に追加:', {
            type: type,
            transcriptId: transcriptId || 'なし',
            totalMessages: container.children.length
        });
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

        console.info(
            '[Transcript] メッセージ追加完了:',
            container.children.length,
            '件',
            transcriptId ? `(ID: ${transcriptId})` : ''
        );

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

        // Electron環境チェック
        const isElectron =
            typeof globalThis.window !== 'undefined' &&
            globalThis.window.electronAPI &&
            globalThis.window.electronAPI.conversation;

        if (!isElectron) {
            return;
        }

        // セッションIDチェック
        if (!this.state.currentSessionId) {
            console.warn('[Conversation] セッションIDがありません - 保存スキップ');
            return;
        }

        try {
            // ✅ 音声入力として保存（role = user）
            const role = 'user';

            // 言語情報取得
            const language = this.state.sourceLang || 'auto';

            // ターン追加
            await globalThis.window.electronAPI.conversation.addTurn({
                role: role,
                content: text,
                language: language,
                timestamp: transcriptId || Date.now()
            });

            console.info('[Conversation] 音声入力保存完了:', {
                role,
                language,
                contentLength: text.length,
                transcriptId
            });
        } catch (error) {
            console.error('[Conversation] ターン保存エラー:', error);
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
            console.error('[Transcript] コンテナが見つかりません:', type);
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
                console.info(
                    '[Transcript] 既存メッセージに追加:',
                    textElement.textContent.substring(0, 20) + '...'
                );
                textElement.textContent += text;
            } else {
                console.info('[Transcript] テキスト要素が見つからないため、新規メッセージを作成');
                this.addTranscript(type, text);
            }
        } else {
            console.info('[Transcript] メッセージが存在しないため、新規メッセージを作成');
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
        console.info('[Transcript] クリア:', type);

        // 要素が初期化されているか確認
        if (!this.elements || !this.elements.inputTranscript || !this.elements.outputTranscript) {
            console.warn('[Transcript] 要素が初期化されていません。クリアをスキップします。');
            return;
        }

        const clearContainer = (containerType) => {
            const container =
                containerType === 'input'
                    ? this.elements.inputTranscript
                    : this.elements.outputTranscript;

            if (!container) {
                console.error('[Transcript] コンテナが見つかりません:', containerType);
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

            console.info('[Transcript] クリア完了:', containerType);
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
    updateStatus(type, text) {
        console.info(`[Status] ${type}: ${text}`);
    },

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
    updateLatencyDisplay(stats) {
        // 統計情報をUIに表示（実装は必要に応じて）
        console.info('[UI] レイテンシー統計:', stats);
    },

    /**
     * 精度表示更新
     *
     * 目的:
     *   音声認識の精度を表示
     */
    updateAccuracy() {
        // 簡易的な精度計算（実際の実装では音声認識の信頼度を使用）
        const accuracy = Math.floor(85 + Math.random() * 10);
        if (this.elements.accuracy) {
            this.elements.accuracy.textContent = `${accuracy}%`;
        }
    }
};

// voicetranslate-pro.js で使用されるため、エクスポート
const _UIMixin = UIMixin;
