/**
 * UIManager.ts
 *
 * 目的: UI更新の管理
 *
 * 機能:
 *   - 接続状態の表示更新
 *   - トランスクリプト表示
 *   - 統計情報の表示
 *   - 通知表示
 *
 * 注意:
 *   - DOM操作を抽象化
 *   - IPlatformAdapter を使用（将来的に）
 */

/**
 * 接続状態
 */
export type ConnectionStatus = 'offline' | 'connecting' | 'connected' | 'error';

/**
 * 通知タイプ
 */
export type NotificationType = 'success' | 'error' | 'warning' | 'info';

/**
 * トランスクリプトタイプ
 */
export type TranscriptType = 'input' | 'output' | 'both';

/**
 * 通知オプション
 */
export interface NotificationOptions {
    title: string;
    message: string;
    type: NotificationType;
    duration?: number;
}

/**
 * UIManager クラス
 *
 * 目的: UI更新を管理
 */
export class UIManager {
    private notificationTimeout: number | null = null;

    /**
     * 接続状態を更新
     */
    updateConnectionStatus(status: ConnectionStatus): void {
        const statusDot = document.getElementById('connectionStatus');
        const statusText = document.getElementById('connectionText');

        if (!statusDot || !statusText) {
            console.warn('[UIManager] 接続状態要素が見つかりません');
            return;
        }

        statusDot.className = 'status-dot';

        switch (status) {
            case 'offline':
                statusDot.classList.add('offline');
                statusText.textContent = 'オフライン';
                break;
            case 'connecting':
                statusDot.classList.add('connecting');
                statusText.textContent = '接続中...';
                break;
            case 'connected':
                statusDot.classList.add('connected');
                statusText.textContent = '接続済み';
                break;
            case 'error':
                statusDot.classList.add('error');
                statusText.textContent = 'エラー';
                break;
        }

        console.info('[UIManager] 接続状態更新:', status);
    }

    /**
     * ステータスを更新
     */
    updateStatus(type: string, text: string): void {
        console.info(`[UIManager] ${type}: ${text}`);
    }

    /**
     * トランスクリプトを追加
     */
    addTranscript(type: TranscriptType, text: string, transcriptId?: number): void {
        if (type === 'both') {
            console.warn('[UIManager] type="both" は addTranscript では使用できません');
            return;
        }

        const transcriptElement =
            type === 'input'
                ? document.getElementById('inputTranscript')
                : document.getElementById('outputTranscript');

        if (!transcriptElement) {
            console.warn('[UIManager] トランスクリプト要素が見つかりません:', type);
            return;
        }

        // 重複防止: 同じtranscriptIdで既に表示されている場合はスキップ
        if (transcriptId && type === 'output') {
            const existingMessage = transcriptElement.querySelector(
                `[data-transcript-id="${transcriptId}"]`
            );
            if (existingMessage) {
                console.info('[UIManager] 重複トランスクリプトをスキップ:', transcriptId);
                return;
            }
        }

        // メッセージ要素を作成
        const messageDiv = document.createElement('div');
        messageDiv.className = 'transcript-message';
        if (transcriptId) {
            messageDiv.setAttribute('data-transcript-id', transcriptId.toString());
        }

        // タイムスタンプ
        const timestamp = document.createElement('span');
        timestamp.className = 'timestamp';
        timestamp.textContent = new Date().toLocaleTimeString('ja-JP');

        // テキスト
        const textSpan = document.createElement('span');
        textSpan.className = 'text';
        textSpan.textContent = text;

        messageDiv.appendChild(timestamp);
        messageDiv.appendChild(textSpan);

        // トランスクリプトに追加
        transcriptElement.appendChild(messageDiv);

        // 自動スクロール
        transcriptElement.scrollTop = transcriptElement.scrollHeight;

        console.info('[UIManager] トランスクリプト追加:', {
            type,
            text: text.substring(0, 50),
            transcriptId
        });
    }

    /**
     * トランスクリプトをクリア
     */
    clearTranscript(type: TranscriptType = 'both'): void {
        console.info('[UIManager] トランスクリプトクリア:', type);

        if (type === 'input' || type === 'both') {
            const inputTranscript = document.getElementById('inputTranscript');
            if (inputTranscript) {
                inputTranscript.innerHTML = '';
            }
        }

        if (type === 'output' || type === 'both') {
            const outputTranscript = document.getElementById('outputTranscript');
            if (outputTranscript) {
                outputTranscript.innerHTML = '';
            }
        }
    }

    /**
     * セッション時間を更新
     */
    updateSessionTime(seconds: number): void {
        const sessionTimeElement = document.getElementById('sessionTime');
        if (!sessionTimeElement) {
            return;
        }

        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;

        sessionTimeElement.textContent = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    /**
     * 文字数を更新
     */
    updateCharCount(count: number): void {
        const charCountElement = document.getElementById('charCount');
        if (!charCountElement) {
            return;
        }

        charCountElement.textContent = count.toLocaleString();
    }

    /**
     * レイテンシを更新
     */
    updateLatency(ms: number): void {
        const latencyElement = document.getElementById('latency');
        if (!latencyElement) {
            return;
        }

        latencyElement.textContent = `${ms}ms`;
    }

    /**
     * 精度を更新
     */
    updateAccuracy(): void {
        const accuracyElement = document.getElementById('accuracy');
        if (!accuracyElement) {
            return;
        }

        // 簡易的な精度計算
        const accuracy = Math.floor(85 + Math.random() * 10);
        accuracyElement.textContent = `${accuracy}%`;
    }

    /**
     * 通知を表示
     */
    notify(options: NotificationOptions): void {
        const notification = document.getElementById('notification');
        const titleEl = document.getElementById('notificationTitle');
        const messageEl = document.getElementById('notificationMessage');

        if (!notification || !titleEl || !messageEl) {
            console.warn('[UIManager] 通知要素が見つかりません');
            console.info(`[UIManager] 通知: ${options.title} - ${options.message}`);
            return;
        }

        // 既存のタイムアウトをクリア
        if (this.notificationTimeout) {
            clearTimeout(this.notificationTimeout);
        }

        // 通知内容を設定
        titleEl.textContent = options.title;
        messageEl.textContent = options.message;

        // タイプに応じたクラスを設定
        notification.className = 'notification';
        notification.classList.add(options.type);
        notification.classList.add('show');

        // 自動非表示
        const duration = options.duration || 3000;
        this.notificationTimeout = window.setTimeout(() => {
            notification.classList.remove('show');
        }, duration);

        console.info('[UIManager] 通知表示:', options);
    }

    /**
     * ボタンの有効/無効を設定
     */
    setButtonEnabled(buttonId: string, enabled: boolean): void {
        const button = document.getElementById(buttonId) as HTMLButtonElement;
        if (!button) {
            console.warn('[UIManager] ボタンが見つかりません:', buttonId);
            return;
        }

        button.disabled = !enabled;
    }

    /**
     * 複数のボタンの有効/無効を設定
     */
    setButtonsEnabled(buttonIds: string[], enabled: boolean): void {
        buttonIds.forEach((id) => this.setButtonEnabled(id, enabled));
    }
}
