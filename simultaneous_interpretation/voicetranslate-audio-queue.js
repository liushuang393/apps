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
        // ✅ 一意ID生成
        this.id = 'seg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

        // ✅ 音声データ (追加: 直接保存してスキップ検証を可能にする)
        this.audio = audioData;
        this.audioData = audioData; // Path1/Path2 処理器から直接アクセス

        // ✅ メタデータ
        this.metadata = {
            timestamp: metadata.timestamp || Date.now(),
            duration: metadata.duration || 0,
            language: metadata.language || null,
            sourceType: metadata.sourceType || 'unknown'
        };

        // ✅ 双パス処理状態
        this.processingStatus = {
            path1_text: 0, // 0=未処理, 1=完了
            path2_voice: 0 // 0=未処理, 1=完了
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

        console.info('[AudioSegment] 作成:', {
            id: this.id,
            duration: this.metadata.duration + 'ms',
            language: this.metadata.language,
            samples: audioData && audioData.length ? audioData.length : 0
        });
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
            this.processingStatus.path1_text = 1;
            this.results.path1 = result;
        } else {
            this.processingStatus.path2_voice = 1;
            this.results.path2 = result;
        }

        console.info('[AudioSegment] パス完了:', {
            id: this.id,
            path: pathName,
            progress: this.getProgress() * 100 + '%',
            fullyProcessed: this.isFullyProcessed()
        });
    }

    /**
     * 全パス完了チェック
     *
     * @returns {boolean} 所有パス完了返却true
     */
    isFullyProcessed() {
        return this.processingStatus.path1_text === 1 && this.processingStatus.path2_voice === 1;
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
            console.warn('[AudioSegment] 音声データは既に送信済み:', this.id);
            return;
        }

        this.audioSent = true;
        console.info('[AudioSegment] 音声データ送信完了:', {
            id: this.id,
            waiters: this.audioSendWaiters.length
        });

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
            console.info('[AudioSegment] 音声データは既に送信済み、待機不要:', this.id);
            return;
        }

        console.info('[AudioSegment] 音声データ送信完了を待機中...', {
            id: this.id,
            currentWaiters: this.audioSendWaiters.length
        });

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
        const completed = this.processingStatus.path1_text + this.processingStatus.path2_voice;
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
 * queue.on('segmentReady', (segment) => {
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
            minSegmentDuration: options.minSegmentDuration || 1000,
            maxQueueSize: options.maxQueueSize || 20,
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
            onSegmentReady: null,
            onSegmentComplete: null,
            onQueueFull: null
        };

        console.info('[AudioQueue] 初期化完了:', {
            maxSegmentDuration: this.config.maxSegmentDuration + 'ms',
            minSegmentDuration: this.config.minSegmentDuration + 'ms',
            maxQueueSize: this.config.maxQueueSize
        });
    }

    /**
     * 音声追加セグメント到队列
     *
     * @param {ArrayBuffer|string} audioData 音声数据
     * @param {Object} metadata メタデータ
     * @returns {AudioSegment|null} 返却セグメント或null（如果被拒绝）
     */
    enqueue(audioData, metadata = {}) {
        // ✅ 時長チェック
        if (metadata.duration < this.config.minSegmentDuration) {
            console.warn('[AudioQueue] 音声が短すぎる、スキップ:', {
                duration: metadata.duration + 'ms',
                minRequired: this.config.minSegmentDuration + 'ms'
            });
            this.stats.droppedSegments++;
            return null;
        }

        if (metadata.duration > this.config.maxSegmentDuration) {
            console.warn('[AudioQueue] 音声が長すぎる:', {
                duration: metadata.duration + 'ms',
                maxAllowed: this.config.maxSegmentDuration + 'ms',
                note: '分割が必要（TODO）'
            });
            // TODO: 音声分割処理
        }

        // ✅ キュー容量チェック
        if (this.queue.size >= this.config.maxQueueSize) {
            console.error('[AudioQueue] キューが満杯:', {
                currentSize: this.queue.size,
                maxSize: this.config.maxQueueSize
            });

            if (this.listeners.onQueueFull !== null) {
                this.listeners.onQueueFull(this.queue.size);
            }

            this.stats.droppedSegments++;
            return null;
        }

        // ✅ 音声セグメント作成
        const segment = new AudioSegment(audioData, metadata);
        this.queue.set(segment.id, segment);
        this.stats.totalSegments++;
        this.stats.currentQueueSize = this.queue.size;

        console.info('[AudioQueue] セグメント追加:', {
            id: segment.id,
            queueSize: this.queue.size,
            duration: metadata.duration + 'ms'
        });

        // ✅ リスナー通知
        if (this.listeners.onSegmentReady !== null) {
            // setTimeoutを使用(0)して非同期実行を保証
            setTimeout(() => {
                if (this.listeners.onSegmentReady !== null) {
                    this.listeners.onSegmentReady(segment);
                }
            }, 0);
        }

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
     * マークパス処理完了
     *
     * @param {string} segmentId セグメントID
     * @param {string} pathName パス名（'path1' 或 'path2'）
     * @param {any} result 処理結果
     */
    markPathComplete(segmentId, pathName, result = null) {
        const segment = this.queue.get(segmentId);
        if (segment === undefined) {
            console.warn('[AudioQueue] セグメントが見つかりません:', segmentId);
            return;
        }

        // ✅ マーク完了
        segment.markPathComplete(pathName, result);

        console.info('[AudioQueue] パス完了通知:', {
            segmentId,
            pathName,
            progress: (segment.getProgress() * 100).toFixed(0) + '%',
            fullyProcessed: segment.isFullyProcessed()
        });

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
        console.info('[AudioQueue] セグメント完全処理完了:', {
            id: segment.id,
            duration: segment.metadata.duration + 'ms',
            age: segment.getAge() + 'ms',
            results: {
                path1: segment.results.path1 !== null ? 'OK' : 'N/A',
                path2: segment.results.path2 !== null ? 'OK' : 'N/A'
            }
        });

        // ✅ リスナー通知
        if (this.listeners.onSegmentComplete !== null) {
            this.listeners.onSegmentComplete(segment);
        }

        // ✅ 遅延クリーンアップ（結果使用を許可）
        setTimeout(() => {
            this.cleanup(segment.id);
        }, this.config.cleanupDelay);
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

            console.info('[AudioQueue] セグメント削除:', {
                id: segmentId,
                remainingInQueue: this.queue.size
            });
        } else {
            console.warn('[AudioQueue] セグメントは未完了のため削除できません:', {
                id: segmentId,
                progress: (segment.getProgress() * 100).toFixed(0) + '%'
            });
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
     * @param {string} event イベント名（'segmentReady', 'segmentComplete', 'queueFull'）
     * @param {Function} callback コールバック関数
     * @throws {Error} 無効なイベント名
     */
    on(event, callback) {
        if (event === 'segmentReady') {
            this.listeners.onSegmentReady = callback;
        } else if (event === 'segmentComplete') {
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
        console.info('[AudioQueue] キューをクリア:', { clearedCount: size });
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
