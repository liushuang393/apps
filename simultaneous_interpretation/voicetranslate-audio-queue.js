/**
 * VoiceTranslate Pro 2.0 - 音声セグメント管理モジュール
 *
 * 目的:
 *   双パス非同期音声処理アーキテクチャの実装
 *   - パス1: テキストパス（STT → テキスト表示 → 翻訳）
 *   - パス2: 音声パス（Voice-to-Voice → 音声再生）
 *
 * @author VoiceTranslate Pro Team
 * @version 2.1.0
 */

/**
 * 音声セグメントクラス
 *
 * @description
 * 処理待ちの音声セグメントを表し、双パス処理状態を追跡
 *
 * @example
 * ```javascript
 * const segment = new AudioSegment(audioData, {
 *     duration: 5000,
 *     language: 'en'
 * });
 *
 * // パス1完了
 * segment.markPathComplete('path1', { transcript: 'Hello' });
 *
 * // パス2完了
 * segment.markPathComplete('path2', { audio: '...', text: 'こんにちは' });
 *
 * // 全処理完了チェック
 * if (segment.isFullyProcessed()) {
 *     console.log('クリーンアップ可能');
 * }
 * ```
 */
class AudioSegment {
    /**
     * @param {ArrayBuffer|string} audioData 音声データ（base64またはArrayBuffer）
     * @param {Object} metadata メタデータ
     * @param {number} metadata.duration 音声時長（ミリ秒）
     * @param {string} metadata.language 言語コード
     * @param {number} [metadata.timestamp] タイムスタンプ（オプション）
     */
    constructor(audioData, metadata = {}) {
        // ✅ 一意ID生成（alignment層から渡された安定IDを優先）
        this.id =
            metadata.segmentId ||
            metadata.id ||
            'seg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        this.segmentId = this.id;

        // ✅ 音声データ (追加: 直接保存してスキップ検証を可能にする)
        this.audio = audioData;
        this.audioData = audioData; // Path1/Path2 処理器から直接アクセス

        // ✅ メタデータ
        this.metadata = {
            timestamp: metadata.timestamp || Date.now(),
            duration: metadata.duration || 0,
            language: metadata.language || null,
            sourceType: metadata.sourceType || 'unknown',
            alignmentId: this.id
        };

        this.alignment = {
            id: this.id,
            responseId: null,
            inputText: '',
            outputText: '',
            inputFinal: false,
            outputFinal: false
        };

        // ✅ 双パス処理状態
        this.processingStatus = {
            path1_text: 0, // 0=未取得, 1=取得済み（処理中）, 2=完了
            path2_voice: 0 // 0=未取得, 1=取得済み（処理中）, 2=完了
        };

        // ✅ 処理結果
        this.results = {
            path1: null, // テキストパス結果
            path2: null // 音声パス結果
        };

        // ✅ 作成時刻
        this.createdAt = Date.now();

        // ✅ 音声送信状態（重複送信防止）
        this.audioSent = false; // 音声がサーバーに送信済みかフラグ
        this.audioSendWaiters = []; // 音声送信完了待ちコールバックリスト
    }

    /**
     * マークパス取得済み（処理開始）
     *
     * @param {string} pathName パス名（'path1' 或 'path2'）
     * @throws {Error} 無効なパス名
     * @returns {boolean} 取得成功の場合は true、既に取得済みの場合は false
     */
    markPathConsumed(pathName) {
        if (pathName !== 'path1' && pathName !== 'path2') {
            throw new Error(`無効なパス名: ${pathName}`);
        }

        const statusKey = pathName === 'path1' ? 'path1_text' : 'path2_voice';

        // ✅ 既に取得済みの場合はスキップ
        if (this.processingStatus[statusKey] >= 1) {
            return false;
        }

        // ✅ 取得済みにマーク
        this.processingStatus[statusKey] = 1;
        return true;
    }

    /**
     * マークパス完了
     *
     * @param {string} pathName パス名（'path1' 或 'path2'）
     * @param {any} result 処理結果
     * @throws {Error} 無効なパス名
     */
    markPathComplete(pathName, result = null) {
        if (pathName !== 'path1' && pathName !== 'path2') {
            throw new Error(`無効なパス名: ${pathName}`);
        }

        // 状態更新
        if (pathName === 'path1') {
            this.processingStatus.path1_text = 2;
            this.results.path1 = result;
        } else {
            this.processingStatus.path2_voice = 2;
            this.results.path2 = result;
        }
    }

    /**
     * 全パス完了チェック
     *
     * @returns {boolean} 所有パス完了返却true
     */
    isFullyProcessed() {
        return this.processingStatus.path1_text === 2 && this.processingStatus.path2_voice === 2;
    }

    /**
     * パスが取得可能かチェック
     *
     * @param {string} pathName パス名（'path1' 或 'path2'）
     * @returns {boolean} 取得可能な場合は true
     */
    isPathAvailable(pathName) {
        const statusKey = pathName === 'path1' ? 'path1_text' : 'path2_voice';
        return this.processingStatus[statusKey] === 0;
    }

    /**
     * マーク音声送信済み（サーバーへ）
     *
     * @description
     * パス1から呼び出され，通知音声已送信完了
     * 全待機中の Path2 処理器
     */
    markAudioSent() {
        if (this.audioSent) {
            return;
        }

        this.audioSent = true;

        // 全待機コールバック起動
        this.audioSendWaiters.forEach((resolve) => resolve());
        this.audioSendWaiters = [];
    }

    /**
     * 待機音声送信完了
     *
     * @description
     * 由 Path2 调用，パス1の音声送信完了待機
     * 如果送信済み、即座に返却；否则待機
     *
     * @returns {Promise<void>}
     * @throws {Error} タイムアウトエラー（30秒）
     */
    async waitForAudioSent() {
        if (this.audioSent) {
            // 送信済み、即座に返却
            return;
        }

        // 待機Promise作成
        return new Promise((resolve, reject) => {
            // 待機リストに追加
            this.audioSendWaiters.push(resolve);

            // タイムアウト保護（30秒）
            const timeout = setTimeout(() => {
                // 待機リストから削除
                const index = this.audioSendWaiters.indexOf(resolve);
                if (index > -1) {
                    this.audioSendWaiters.splice(index, 1);
                }
                reject(new Error(`音声データ送信タイムアウト: ${this.id}`));
            }, 30000);

            // 送信済みの場合（競合状態）、即座にresolve
            if (this.audioSent) {
                clearTimeout(timeout);
                resolve();
            }
        });
    }

    /**
     * 取得処理進捗
     *
     * @returns {number} 進捗（0.0 ~ 1.0）
     */
    getProgress() {
        const total = 2;
        // processingStatus は 0=未取得 / 1=処理中 / 2=完了 の3状態。
        // 進捗は「完了(=2)したパス数 / 全パス数」で 0.0〜1.0 に正規化する。
        const completed =
            (this.processingStatus.path1_text === 2 ? 1 : 0) +
            (this.processingStatus.path2_voice === 2 ? 1 : 0);
        return completed / total;
    }

    /**
     * 取得音声時長（ミリ秒）
     *
     * @returns {number} 時長
     */
    getDuration() {
        return this.metadata.duration;
    }

    /**
     * 取得経過時間（作成からのミリ秒数）
     *
     * @returns {number} 経過時間（ミリ秒）
     */
    getAge() {
        return Date.now() - this.createdAt;
    }

    /**
     * 取得サマリー情報
     *
     * @returns {Object} サマリー情報
     */
    getSummary() {
        return {
            id: this.id,
            duration: this.metadata.duration,
            language: this.metadata.language,
            progress: this.getProgress(),
            age: this.getAge(),
            path1Status: this.processingStatus.path1_text,
            path2Status: this.processingStatus.path2_voice,
            fullyProcessed: this.isFullyProcessed()
        };
    }
}

/**
 * 音声队列管理类
 *
 * @description
 * 管理音声セグメント的生命周期，实现智能缓冲和自动クリーンアップ
 *
 * @example
 * ```javascript
 * const queue = new AudioQueue({
 *     maxSegmentDuration: 15000,  // 最大15秒
 *     minSegmentDuration: 1000,   // 最小1秒
 *     maxQueueSize: 20
 * });
 *
 * // イベント監視
 * queue.on('segmentComplete', (segment) => {
 *     processSegment(segment);
 * });
 *
 * // 音声追加
 * const segment = queue.enqueue(audioData, {
 *     duration: 5000,
 *     language: 'en'
 * });
 * ```
 */
class AudioQueue {
    /**
     * @param {Object} options 設定オプション
     * @param {number} [options.maxSegmentDuration=15000] 最大セグメント時長（ミリ秒）
     * @param {number} [options.minSegmentDuration=1000] 最小セグメント時長（ミリ秒）
     * @param {number} [options.maxQueueSize=20] 最大キューサイズ
     * @param {number} [options.cleanupDelay=1000] クリーンアップ延迟（ミリ秒）
     */
    constructor(options = {}) {
        // ✅ キューストレージ（Map: ID → AudioSegment）
        this.queue = new Map();

        // ✅ 設定
        this.config = {
            maxSegmentDuration: options.maxSegmentDuration || 15000,
            // ✅ 最小セグメント時長: 300ms（品質優先 - 短い単語も重要）
            minSegmentDuration: options.minSegmentDuration || 300,
            // 翻訳漏れ厳禁: バースト発話でも取りこぼさないよう十分な深さを確保する。
            // （満杯時は enqueue が drop するため、20 では会議の連続発話で漏れやすい）
            maxQueueSize: options.maxQueueSize || 100,
            cleanupDelay: options.cleanupDelay || 1000
        };

        // ✅ 統計情報
        this.stats = {
            totalSegments: 0,
            processedSegments: 0,
            droppedSegments: 0,
            currentQueueSize: 0
        };

        // ✅ イベントリスナー
        this.listeners = {
            onSegmentComplete: null,
            onQueueFull: null
        };
    }

    /**
     * 音声追加セグメント到队列
     *
     * @param {ArrayBuffer|string} audioData 音声数据
     * @param {Object} metadata メタデータ
     * @returns {AudioSegment|null} 返却セグメント或null（如果被拒绝）
     */
    enqueue(audioData, metadata = {}) {
        // ✅ デバッグ：enqueue呼び出し確認

        // ✅ 時長チェック
        if (metadata.duration < this.config.minSegmentDuration) {
            this.stats.droppedSegments++;
            return null;
        }

        // ✅ 長音声チェック（警告のみ、分割は後で実装）
        if (metadata.duration > this.config.maxSegmentDuration) {
            // TODO: 音声分割処理（後で実装）
        }

        // ✅ キュー容量チェック
        if (this.queue.size >= this.config.maxQueueSize) {
            this.stats.droppedSegments++;

            if (this.listeners.onQueueFull !== null) {
                this.listeners.onQueueFull(this.queue.size);
            }

            return null;
        }

        // ✅ 音声セグメント作成
        const segment = new AudioSegment(audioData, metadata);
        this.queue.set(segment.id, segment);
        this.stats.totalSegments++;
        this.stats.currentQueueSize = this.queue.size;

        // ✅ 200秒後に自動クリーンアップ（タイムアウト）
        setTimeout(() => {
            const seg = this.queue.get(segment.id);
            if (seg && !seg.isFullyProcessed()) {
                this.cleanup(segment.id);
            }
        }, 200000); // 200秒

        return segment;
    }

    /**
     * 取得音声セグメント
     *
     * @param {string} segmentId セグメントID
     * @returns {AudioSegment|undefined} セグメント或undefined
     */
    getSegment(segmentId) {
        return this.queue.get(segmentId);
    }

    /**
     * ✅ プル型アーキテクチャ: パス専用の消費メソッド
     *
     * @description
     * 指定されたパスがまだ取得していない最も古い音声セグメントを返す
     * 重複取得を防ぐため、取得済みフラグを設定する
     *
     * @param {string} pathName パス名（'path1' 或 'path2'）
     * @returns {AudioSegment|null} 取得可能なセグメント、なければ null
     */
    consumeForPath(pathName) {
        if (pathName !== 'path1' && pathName !== 'path2') {
            throw new Error(`無効なパス名: ${pathName}`);
        }

        // ✅ キューから最も古い未取得セグメントを検索
        for (const [segmentId, segment] of this.queue) {
            if (segment.isPathAvailable(pathName)) {
                // ✅ 取得済みにマーク（重複防止）
                if (segment.markPathConsumed(pathName)) {
                    return segment;
                }
            }
        }

        // ✅ 取得可能なセグメントがない
        return null;
    }

    /**
     * マークパス処理完了
     *
     * @param {string} segmentId セグメントID
     * @param {string} pathName パス名（'path1' 或 'path2'）
     * @param {any} result 処理結果
     */
    markPathComplete(segmentId, pathName, result = null) {
        const segment = this.queue.get(segmentId);
        if (segment === undefined) {
            return;
        }

        // ✅ マーク完了
        segment.markPathComplete(pathName, result);

        // ✅ 全パス完了チェック
        if (segment.isFullyProcessed()) {
            this.handleSegmentComplete(segment);
        }
    }

    /**
     * 処理セグメント完全完了
     *
     * @private
     * @param {AudioSegment} segment 音声セグメント
     */
    handleSegmentComplete(segment) {
        // ✅ リスナー通知
        if (this.listeners.onSegmentComplete !== null) {
            this.listeners.onSegmentComplete(segment);
        }

        // ✅ 即座にクリーンアップ（両方のパスが完了したので不要）
        this.cleanup(segment.id);
    }

    /**
     * クリーンアップ已完了的セグメント
     *
     * @param {string} segmentId セグメントID
     */
    cleanup(segmentId) {
        const segment = this.queue.get(segmentId);
        if (segment === undefined) {
            return;
        }

        if (segment.isFullyProcessed()) {
            this.queue.delete(segmentId);
            this.stats.processedSegments++;
            this.stats.currentQueueSize = this.queue.size;
        } else {
        }
    }

    /**
     * 取得統計情報
     *
     * @returns {Object} 統計情報
     */
    getStats() {
        const successRate =
            this.stats.totalSegments > 0
                ? ((this.stats.processedSegments / this.stats.totalSegments) * 100).toFixed(2) + '%'
                : '0%';

        return {
            ...this.stats,
            successRate: successRate
        };
    }

    /**
     * 設定イベントリスナー
     *
     * @param {string} event イベント名（'segmentComplete', 'queueFull'）
     * @param {Function} callback コールバック関数
     * @throws {Error} 無効なイベント名
     */
    on(event, callback) {
        if (event === 'segmentComplete') {
            this.listeners.onSegmentComplete = callback;
        } else if (event === 'queueFull') {
            this.listeners.onQueueFull = callback;
        } else {
            throw new Error(`無効なイベント名: ${event}`);
        }
    }

    /**
     * キュークリア
     */
    clear() {
        const size = this.queue.size;
        this.queue.clear();
        this.stats.currentQueueSize = 0;
    }

    /**
     * 取得队列大小
     *
     * @returns {number} 队列中的セグメント数量
     */
    size() {
        return this.queue.size;
    }
}

/**
 * モジュールエクスポート
 */
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { AudioSegment, AudioQueue };
}
