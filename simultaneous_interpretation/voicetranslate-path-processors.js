/**
 * VoiceTranslate Pro 2.0 - 双パス処理器
 *
 * 目的:
 *   实现音声セグメント的双パス异步処理
 *   - パス1: 文本パス（STT → 文本显示 → 翻译）
 *   - パス2: 音声パス（Voice-to-Voice → 音声再生）
 *
 * @author VoiceTranslate Pro Team
 * @version 2.1.0
 */

/**
 * 文本パス処理器
 *
 * @description
 * 负责音声 → 文本 → 翻译的処理流程
 *
 * 処理流程:
 * 1. 音声認識（STT）→ 入力テキスト表示
 * 2. (モード2のみ) テキスト翻訳 → 翻訳テキスト表示
 *
 * @example
 * ```javascript
 * const processor = new TextPathProcessor(audioQueue, voiceApp);
 * processor.setMode(2);  // モード2: テキスト翻訳も実行
 * await processor.process(segment);
 * ```
 */
class TextPathProcessor {
    /**
     * @param {AudioQueue} audioQueue 音声队列
     * @param {VoiceTranslateApp} appInstance 应用实例
     */
    constructor(audioQueue, appInstance) {
        this.audioQueue = audioQueue;
        this.app = appInstance;
        this.mode = 1; // 1=音声のみ, 2=音声+テキスト翻訳
        this.isProcessing = false;
    }

    /**
     * 設定运行模式
     *
     * @param {number} mode 模式（1=音声のみ, 2=音声+テキスト翻訳）
     */
    setMode(mode) {
        if (mode !== 1 && mode !== 2) {
            throw new Error(`無効なモード: ${mode}`);
        }
        this.mode = mode;
    }

    /**
     * 処理音声セグメント（文本パス）
     *
     * @param {AudioSegment} segment 音声セグメント
     * @returns {Promise<void>}
     */
    async process(segment) {
        if (segment === null || segment === undefined) {
            throw new Error('segment は null または undefined です');
        }

        // 翻訳専用セッション（/v1/realtime/translations）は conversation.item.* 転写イベントも
        // 手動 commit も持たない（公式仕様）。音声再送は未知イベントエラーと STT タイムアウトを
        // 生むだけなので行わない。左カラムは session.input_transcript ストリームが担う。
        if (this.app.isRealtimeTranslationSession?.()) {
            this.audioQueue.markPathComplete(segment.id, 'path1', {
                skipped: 'translation-session'
            });
            return;
        }

        try {
            this.isProcessing = true;

            // STT completion can arrive immediately after commit. Register the
            // waiter before sending/committing audio so this segment cannot miss
            // its own transcription event.
            const transcriptPromise = this.speechToText(segment);

            // groupedモードのライブ転写による文数計数と、ここでの音声再送による
            // 転写が二重計数されないよう、再送中はフラグを立てる（finally で解除）。
            this.app.segmentResendDepth = (this.app.segmentResendDepth || 0) + 1;

            // ✅ ステップ0: 音声データをサーバーへ送信
            await this.sendAudioToServer(segment.audioData);

            // ✅ マーク音声已送信（パス2へ通知）
            segment.markAudioSent();

            // ステップ1: 音声認識（STT）
            const transcript = await transcriptPromise;

            if (transcript === null || transcript.trim() === '') {
                // 空でも完了マーク（リトライしない）
                this.audioQueue.markPathComplete(segment.id, 'path1', {
                    transcript: '',
                    error: 'Empty transcript'
                });
                return;
            }

            const transcriptId = segment.segmentId || segment.id;
            segment.transcriptId = transcriptId;

            const alignedSegment = this.app.segmentAlignment?.getSegment(transcriptId);
            const shouldRenderInput =
                !alignedSegment ||
                !alignedSegment.input.text ||
                alignedSegment.input.source !== 'live-sra';

            if (!this.app.segmentAlignment) {
                throw new Error('SegmentAlignmentManager is required for transcript rendering');
            }

            const updated = shouldRenderInput
                ? this.app.segmentAlignment.updateInput(transcriptId, transcript, {
                      isFinal: true,
                      source: 'path1-stt',
                      sourceLang: segment.metadata.language
                  })
                : alignedSegment;
            segment.alignment.inputText = updated.input.text;
            if (shouldRenderInput && typeof this.app.upsertSegmentInput === 'function') {
                this.app.upsertSegmentInput(transcriptId, updated.input.text, {
                    status: 'input-ready'
                });
            }

            if (
                typeof this.app.updateTranscriptBuffer === 'function' &&
                !this.app.isGroupedTurnMode?.()
            ) {
                this.app.updateTranscriptBuffer(transcript);
            }

            // モード2の場合、テキスト翻訳を続行
            if (this.mode === 2) {
                const translatedText =
                    typeof this.app.translateTextDirectly === 'function'
                        ? await this.app.translateTextDirectly(
                              transcript,
                              transcriptId,
                              segment.metadata.language
                          )
                        : await this.translateText(transcript, transcriptId);

                if (translatedText === null || translatedText === undefined) {
                    this.audioQueue.markPathComplete(segment.id, 'path1', {
                        transcript: transcript,
                        error: 'Empty translation'
                    });
                } else if (translatedText === '') {
                    // 定型句検出で破棄された場合は表示せず、認識結果のみ完了扱いにする
                    this.audioQueue.markPathComplete(segment.id, 'path1', {
                        transcript: transcript
                    });
                } else {
                    if (typeof this.app.translateTextDirectly !== 'function') {
                        // 翻訳テキスト表示
                        this.displayTranslatedText(translatedText, transcriptId);
                    }

                    // マーク完了
                    this.audioQueue.markPathComplete(segment.id, 'path1', {
                        transcript: transcript,
                        translatedText: translatedText
                    });
                }
            } else {
                // モード1の場合、音声認識のみ
                this.audioQueue.markPathComplete(segment.id, 'path1', {
                    transcript: transcript
                });
            }
        } catch (error) {
            // エラーでも完了マーク（リトライしない）
            this.audioQueue.markPathComplete(segment.id, 'path1', {
                error: error.message
            });
        } finally {
            this.isProcessing = false;
            // 再送中フラグを解除（groupedモードの文数計数ガード）
            if (this.app.segmentResendDepth) {
                this.app.segmentResendDepth = Math.max(0, this.app.segmentResendDepth - 1);
            }
        }
    }

    /**
     * 送信音声数据到服务器
     *
     * @private
     * @param {Float32Array} audioData - 音声数据
     * @returns {Promise<void>}
     */
    async sendAudioToServer(audioData) {
        if (!audioData || audioData.length === 0) {
            throw new Error('音声データが空です');
        }

        // ✅ サーバVAD（turn_detection）有効時は音声再送＋手動commitをスキップする。
        //    理由: サーバの semantic_vad/server_vad が既にライブ音声をターン毎に
        //    自動 commit＆文字起こし済み。ここで同じ音声を再送し手動 commit すると、
        //    サーバのターン境界自動 commit と競合して残りバッファが <100ms になり、
        //    "Error committing input audio buffer: buffer too small" を誘発する。
        //    左列の入力テキストはライブ転写（handleTranscriptionCompleted）が独立して埋め、
        //    Path2 の response.create はサーバ会話コンテキスト（自動 commit 済み音声）を翻訳する。
        const serverVadActive = !!this.app.elements?.vadEnabled?.classList?.contains('active');
        if (serverVadActive) {
            return;
        }

        // 使用主应用的 sendAudioData 方法（会转换为PCM16并送信）
        // 批量送信以避免过载
        const CHUNK_SIZE = 4800; // 200ms @ 24kHz
        let offset = 0;
        let sentSamples = 0;

        while (offset < audioData.length) {
            const chunkSize = Math.min(CHUNK_SIZE, audioData.length - offset);
            const chunk = audioData.subarray(offset, offset + chunkSize);

            // ✅ チャンク有効性チェック
            if (!chunk || chunk.length === 0) {
                break;
            }

            // 送信音声块
            const sent = this.app.sendAudioData(chunk, { force: true });
            if (sent) {
                sentSamples += chunk.length;
            }

            offset += chunkSize;

            // 小延迟以避免过载
            if (offset < audioData.length) {
                await new Promise((resolve) => setTimeout(resolve, 10));
            }
        }

        if (sentSamples === 0) {
            throw new Error('Realtime APIへ音声データを送信できませんでした');
        }

        // ✅ 验证所有数据都已发送
        if (sentSamples < audioData.length) {
        }

        // 提交音声缓冲区
        const committed = this.app.commitRealtimeInputAudioBuffer('path1-stt');
        if (!committed) {
            throw new Error(
                'Realtime APIへ送信した音声データが短すぎるため、commitをスキップしました'
            );
        }
    }

    /**
     * 音声认识（STT）
     *
     * @private
     * @param {AudioSegment} segment 音声セグメント
     * @returns {Promise<string>} 转录文本
     */
    async speechToText(segment) {
        // 从 WebSocket 消息流中提取 transcript
        // OpenAI Realtime API 在 input_audio_buffer.committed 后会送信
        // conversation.item.input_audio_transcription.completed イベント

        // 创建 Promise 来待機转录完了
        return new Promise((resolve, reject) => {
            let transcriptText = null;
            let settled = false;

            const cleanup = () => {
                this.app.removeRealtimeMessageListener?.(transcriptionListener);
            };

            const timeoutId = setTimeout(() => {
                if (settled) {
                    return;
                }
                settled = true;
                cleanup();
                reject(new Error('STT timeout (30s)'));
            }, 30000);

            const transcriptionListener = (message) => {
                if (message.type === 'conversation.item.input_audio_transcription.completed') {
                    if (settled) {
                        return;
                    }
                    settled = true;
                    clearTimeout(timeoutId);
                    transcriptText = message.transcript || '';

                    // ✅ 自動言語検出: 文字種からリアル言語を判定
                    const detectedLanguage = this.detectLanguageFromTranscript(transcriptText);

                    // ✅ セグメントのメタデータを実際の言語に更新
                    // これにより、displayInputText() で正しい言語ラベルが表示される
                    if (detectedLanguage && detectedLanguage !== segment.metadata.language) {
                        segment.metadata.language = detectedLanguage;
                    }

                    // 移除监听器
                    cleanup();

                    resolve(transcriptText);
                }
            };

            // 添加监听器
            if (this.app.isRealtimeTransportReady?.()) {
                this.app.addRealtimeMessageListener(transcriptionListener);
            } else {
                clearTimeout(timeoutId);
                reject(new Error('WebSocket 未接続または未準備'));
                return;
            }

            // 注意: 音声已经通过 input_audio_buffer.append 送信到服务器
            // 这里只需要待機转录結果
            // 实际的音声送信由 VAD → handleAudioBufferCommitted 完了
        });
    }

    /**
     * 文字型からリアル言語を検出
     *
     * @private
     * @param {string} text - テキスト
     * @returns {string|null} 言語コード ('ja', 'zh', 'en', 'vi') または null
     */
    detectLanguageFromTranscript(text) {
        if (!text || text.trim().length === 0) {
            return null;
        }

        const fallback =
            this.app?.state?.sourceLang && this.app.state.sourceLang !== 'auto'
                ? this.app.state.sourceLang
                : 'en';

        if (typeof Utils !== 'undefined' && Utils.detectSupportedLanguageFromText) {
            return Utils.detectSupportedLanguageFromText(text, fallback);
        }

        const supportedFallback = ['ja', 'zh', 'en', 'vi'].includes(fallback) ? fallback : 'en';
        const value = text.trim();

        if (/[\u3040-\u30ff]/.test(value)) {
            return 'ja';
        }

        if (
            /[ăâđêôơưĂÂĐÊÔƠƯàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/i.test(
                value
            )
        ) {
            return 'vi';
        }

        if (/[\u3400-\u9fff]/.test(value)) {
            return 'zh';
        }

        if (/[A-Za-z]/.test(value)) {
            return 'en';
        }

        return supportedFallback;
    }

    /**
     * 文本翻译
     *
     * @private
     * @param {string} text 原文
     * @returns {Promise<string>} 翻译文本
     */
    async translateText(text) {
        if (this.app.platform?.isElectron) {
            const generation =
                this.app.state.connectionGeneration || this.app.platform.connectionId;
            if (!generation) {
                throw new Error('Realtime 接続がありません');
            }
            const result = await this.app.platform.translateText({
                sessionId: this.app.state.currentSessionId || 0,
                generation,
                segmentId: `legacy_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                text,
                ...(this.app.state.sourceLang ? { sourceLanguage: this.app.state.sourceLang } : {}),
                targetLanguage: this.app.state.targetLang || 'ja'
            });
            return Utils.stripAssistantBoilerplate(result.text || '');
        }

        // OpenAI Chat Completions API を使用
        const chatModel = this.app.config?.chatModel || CONFIG.API.CHAT_MODEL;
        const apiKey = this.app.config?.apiKey || this.app.state?.apiKey;
        const targetLanguage =
            this.app.config?.targetLanguage || this.app.state?.targetLang || 'ja';

        if (chatModel === null || chatModel === undefined) {
            throw new Error('chatModel が設定されていません');
        }

        if (!apiKey) {
            throw new Error('APIキーが設定されていません');
        }

        const response = await fetch(CONFIG.API.CHAT_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: chatModel,
                messages: [
                    {
                        role: 'system',
                        content: `You are a professional translator. Translate the following text to ${targetLanguage}. Only output the translation, no explanations.`
                    },
                    {
                        role: 'user',
                        content: text
                    }
                ],
                // 翻訳は決定的に（会話化回避）。gpt-5 は temperature 非対応のため除外する。
                ...(chatModel?.startsWith('gpt-5') ? {} : { temperature: 0 })
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Translation API error: ${response.status} ${errorText}`);
        }

        const data = await response.json();
        // 防御的後処理: アシスタント定型句を除去（多層防御）。破棄すべき場合は '' を返す。
        return Utils.stripAssistantBoilerplate(data.choices[0].message.content);
    }

    /**
     * 显示输入文本
     *
     * @private
     * @param {string} text 文本
     * @param {string} language 语言代码
     */
    displayInputText(text, language, transcriptId = null) {
        // ✅ 自動検出言語で状態を更新（UI削除後の後替案）
        if (language && language !== 'auto') {
            this.app.state.sourceLang = language;
        }

        const timestamp = new Date().toLocaleTimeString('ja-JP');

        // 自動検出言語を左「入力音声」欄のラベル(sourceLangDisplay)に反映（専用欄は廃止）
        this.updateSourceLangDisplay(language);

        if (typeof this.app.addTranscript === 'function') {
            this.app.addTranscript('input', text, transcriptId);
            return;
        }

        const container = this.app.elements.inputTranscript;
        if (!container) {
            return;
        }

        const entry = document.createElement('div');
        entry.className = 'transcript-message';
        if (transcriptId) {
            entry.dataset.transcriptId = transcriptId;
        }
        entry.innerHTML = `
            <div class="transcript-time">${timestamp}</div>
            <div class="transcript-text">${this.escapeHtml(text)}</div>
        `;

        container.insertBefore(entry, container.firstChild);
        container.scrollTop = 0;
    }

    /**
     * ソース言語表示を更新
     *
     * @private
     * @param {string} detectedLanguage - 検出した言語コード
     */
    updateSourceLangDisplay(detectedLanguage) {
        const sourceLangDisplay = this.app.elements.sourceLangDisplay;

        // ✅ 要素が見つからない場合は直接取得
        let element = sourceLangDisplay;
        if (!element) {
            element = document.getElementById('sourceLangDisplay');
            if (!element) {
                return;
            }
            this.app.elements.sourceLangDisplay = element;
        }

        // 言語コードから言語名へ変換（対応言語: 英語、日本語、簡体中文、ベトナム語のみ）
        const languageNames = {
            ja: '日本語',
            en: 'English',
            zh: '简体中文',
            vi: 'Tiếng Việt',
            auto: '🔄 自動'
        };

        const languageEmojis = {
            ja: '🇯🇵',
            en: '🇬🇧',
            zh: '🇨🇳',
            vi: '🇻🇳'
        };

        const displayName = languageNames[detectedLanguage] || detectedLanguage;
        const emoji = languageEmojis[detectedLanguage] || '❓';

        // ✅ UI を更新
        element.textContent = `${emoji} ${displayName}`;
    }

    /**
     * 显示翻译文本
     *
     * @private
     * @param {string} text 翻译文本
     */
    displayTranslatedText(text, transcriptId = null) {
        if (typeof this.app.addTranscript === 'function') {
            this.app.addTranscript('output', text, transcriptId);
            return;
        }

        const timestamp = new Date().toLocaleTimeString('ja-JP');
        const targetLanguage =
            this.app.config?.targetLanguage || this.app.state?.targetLang || 'unknown';
        const container = this.app.elements.outputTranscript;

        if (!container) {
            return;
        }

        const entry = document.createElement('div');
        entry.className = 'transcript-message translation';
        if (transcriptId) {
            entry.dataset.transcriptId = transcriptId;
        }
        entry.innerHTML = `
            <div class="transcript-meta">
                <span class="transcript-time">${timestamp}</span>
                <span class="transcript-lang">[${targetLanguage}]</span>
                <span class="transcript-label">翻訳:</span>
            </div>
            <div class="transcript-text">${this.escapeHtml(text)}</div>
        `;

        container.insertBefore(entry, container.firstChild);
        container.scrollTop = 0;
    }

    /**
     * HTML转义
     *
     * @private
     * @param {string} text 文本
     * @returns {string} 转义后的文本
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

/**
 * 音声パス処理器
 *
 * @description
 * 负责音声 → Voice-to-Voice 翻译 → 音声再生的処理流程
 *
 * 処理流程:
 * 1. 音声翻訳（OpenAI Realtime API）
 * 2. 音声再生
 * 3. (モード1のみ) テキストも表示
 *
 * @example
 * ```javascript
 * const processor = new VoicePathProcessor(audioQueue, voiceApp);
 * processor.setMode(1);  // モード1: テキスト表示あり
 * await processor.process(segment);
 * ```
 */
class VoicePathProcessor {
    /**
     * @param {AudioQueue} audioQueue 音声队列
     * @param {VoiceTranslateApp} appInstance 应用实例
     */
    constructor(audioQueue, appInstance) {
        this.audioQueue = audioQueue;
        this.app = appInstance;
        this.mode = 1; // 1=テキスト表示あり, 2=テキスト表示なし
        this.isProcessing = false;
    }

    /**
     * 設定运行模式
     *
     * @param {number} mode 模式（1=テキスト表示あり, 2=テキスト表示なし）
     */
    setMode(mode) {
        if (mode !== 1 && mode !== 2) {
            throw new Error(`無効なモード: ${mode}`);
        }
        this.mode = mode;
    }

    /**
     * 処理音声セグメント（音声パス）
     *
     * @param {AudioSegment} segment 音声セグメント
     * @returns {Promise<void>}
     */
    async process(segment) {
        if (segment === null || segment === undefined) {
            throw new Error('segment は null または undefined です');
        }

        // リアルタイム音声翻訳セッションでは per-segment の response.create を発行しない。
        // 翻訳音声/テキストは session.output_* イベントでストリーム受信し、
        // mixin 側（handleAudioDelta / handleTranslationTranscriptDelta）が再生・表示する。
        // Path2 はパイプライン互換のため完了マークのみ行う。
        this.audioQueue.markPathComplete(segment.id, 'path2', {
            skipped: 'translation-session'
        });
    }
}

/**
 * モジュールエクスポート
 */
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { TextPathProcessor, VoicePathProcessor };
}
