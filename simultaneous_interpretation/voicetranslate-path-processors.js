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

        console.info('[TextPathProcessor] 初期化完了');
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
        console.info('[TextPathProcessor] モード設定:', {
            mode: this.mode,
            description: this.mode === 1 ? '音声のみ' : '音声+テキスト翻訳'
        });
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

        try {
            console.info('[Path1] テキスト処理開始:', {
                segmentId: segment.id,
                mode: this.mode,
                duration: segment.getDuration() + 'ms',
                samples: segment.audioData ? segment.audioData.length : 0
            });

            this.isProcessing = true;

            // ✅ ステップ0: 音声データをサーバーへ送信
            await this.sendAudioToServer(segment.audioData);

            // ✅ マーク音声已送信（パス2へ通知）
            segment.markAudioSent();

            // ステップ1: 音声認識（STT）
            const transcript = await this.speechToText(segment);

            if (transcript === null || transcript.trim() === '') {
                console.warn('[Path1] 音声認識結果が空:', { segmentId: segment.id });
                // 空でも完了マーク（リトライしない）
                this.audioQueue.markPathComplete(segment.id, 'path1', {
                    transcript: '',
                    error: 'Empty transcript'
                });
                return;
            }

            console.info('[Path1] 音声認識完了:', {
                segmentId: segment.id,
                transcript: transcript.substring(0, 50) + '...',
                length: transcript.length
            });

            // 入力テキスト表示
            this.displayInputText(transcript, segment.metadata.language);

            // モード2の場合、テキスト翻訳を続行
            if (this.mode === 2) {
                const translatedText = await this.translateText(transcript);

                console.info('[Path1] テキスト翻訳完了:', {
                    segmentId: segment.id,
                    translatedText: translatedText.substring(0, 50) + '...',
                    length: translatedText.length
                });

                // 翻訳テキスト表示
                this.displayTranslatedText(translatedText);

                // マーク完了
                this.audioQueue.markPathComplete(segment.id, 'path1', {
                    transcript: transcript,
                    translatedText: translatedText
                });
            } else {
                // モード1の場合、音声認識のみ
                this.audioQueue.markPathComplete(segment.id, 'path1', {
                    transcript: transcript
                });
            }

            console.info('[Path1] 処理完了:', { segmentId: segment.id });
        } catch (error) {
            console.error('[Path1] 処理エラー:', {
                segmentId: segment.id,
                error: error.message,
                stack: error.stack
            });

            // エラーでも完了マーク（リトライしない）
            this.audioQueue.markPathComplete(segment.id, 'path1', {
                error: error.message
            });
        } finally {
            this.isProcessing = false;
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
            console.error('[Path1] 音声データが空です', {
                hasData: !!audioData,
                length: audioData?.length || 0
            });
            throw new Error('音声データが空です');
        }

        // 使用主应用的 sendAudioData 方法（会转换为PCM16并送信）
        // 批量送信以避免过载
        const CHUNK_SIZE = 4800; // 200ms @ 24kHz
        let offset = 0;
        let chunksent = 0;

        console.info('[Path1] 音声データ送信開始:', {
            totalSamples: audioData.length,
            estimatedDuration: (audioData.length / 24000 * 1000).toFixed(2) + 'ms',
            estimatedChunks: Math.ceil(audioData.length / CHUNK_SIZE)
        });

        while (offset < audioData.length) {
            const chunkSize = Math.min(CHUNK_SIZE, audioData.length - offset);
            const chunk = audioData.subarray(offset, offset + chunkSize);

            // ✅ チャンク有効性チェック
            if (!chunk || chunk.length === 0) {
                console.error('[Path1] チャンク抽出エラー:', {
                    offset: offset,
                    chunkSize: chunkSize,
                    extractedLength: chunk?.length || 0
                });
                break;
            }

            // 送信音声块
            this.app.sendAudioData(chunk);
            chunksent++;

            offset += chunkSize;

            // 小延迟以避免过载
            if (offset < audioData.length) {
                await new Promise((resolve) => setTimeout(resolve, 10));
            }
        }

        console.info('[Path1] 音声データ送信完了:', {
            totalSamples: audioData.length,
            chunks: chunksent,
            bytesPerChunk: CHUNK_SIZE,
            completedPercentage: (offset / audioData.length * 100).toFixed(1) + '%'
        });

        // ✅ 验证所有数据都已发送
        if (offset < audioData.length) {
            console.warn('[Path1] 一部のデータが送信されていません:', {
                totalSamples: audioData.length,
                sentSamples: offset,
                missingSamples: audioData.length - offset
            });
        }

        // 提交音声缓冲区
        const commitMessage = {
            type: 'input_audio_buffer.commit'
        };

        this.app.sendMessage(commitMessage);
        console.info('[Path1] input_audio_buffer.commit 送信完了');
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

        console.info('[Path1] STT開始:', {
            segmentId: segment.id,
            duration: segment.getDuration() + 'ms'
        });

        // 创建 Promise 来待機转录完了
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                reject(new Error('STT timeout (30s)'));
            }, 30000);

            let transcriptText = null;

            const transcriptionListener = (event) => {
                const message = JSON.parse(event.data);

                if (message.type === 'conversation.item.input_audio_transcription.completed') {
                    clearTimeout(timeoutId);
                    transcriptText = message.transcript || '';

                    // ✅ 自動言語検出: 文字種からリアル言語を判定
                    const detectedLanguage = this.detectLanguageFromTranscript(transcriptText);

                    console.info('[Path1] STT完了:', {
                        segmentId: segment.id,
                        transcript: transcriptText.substring(0, 50) + '...',
                        presetLanguage: segment.metadata.language,
                        detectedLanguage: detectedLanguage,
                        mismatch: segment.metadata.language !== detectedLanguage ? '⚠️ 言語不一致' : '✅ 一致'
                    });

                    // ✅ セグメントのメタデータを実際の言語に更新
                    // これにより、displayInputText() で正しい言語ラベルが表示される
                    if (detectedLanguage && detectedLanguage !== segment.metadata.language) {
                        console.warn('[Path1] 言語を自動修正:', {
                            from: segment.metadata.language,
                            to: detectedLanguage
                        });
                        segment.metadata.language = detectedLanguage;
                    }

                    // 移除监听器
                    if (this.app.state.ws) {
                        this.app.state.ws.removeEventListener('message', transcriptionListener);
                    }

                    resolve(transcriptText);
                }
            };

            // 添加监听器
            if (this.app.state.ws && this.app.state.ws.readyState === WebSocket.OPEN) {
                this.app.state.ws.addEventListener('message', transcriptionListener);
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
     * @returns {string|null} 言語コード ('ja', 'zh', 'ko', 'en', etc) または null
     */
    detectLanguageFromTranscript(text) {
        if (!text || text.trim().length === 0) {
            return null;
        }

        // ✅ 文字パターンマッチング優先度順
        const patterns = [
            {
                language: 'zh',
                regex: /[\u4E00-\u9FFF]/,  // 中国語
                name: '中文'
            },
            {
                language: 'ja',
                regex: /[\u3040-\u309F\u30A0-\u30FF]/,  // 日本語（ひらがな・カタカナ）
                name: '日本語'
            },
            {
                language: 'ko',
                regex: /[\uAC00-\uD7AF]/,  // ハングル
                name: '한국어'
            },
            {
                language: 'en',
                regex: /^[a-zA-Z\s0-9!?,.\'-]+$/,  // 英字のみ
                name: 'English'
            },
            {
                language: 'es',
                regex: /[\u00E1\u00E9\u00ED\u00F1\u00F3\u00FA]/,  // スペイン語
                name: 'Español'
            },
            {
                language: 'fr',
                regex: /[\u00E0\u00E7\u00E9\u00E8\u00EA\u00FB\u00F9]/,  // フランス語
                name: 'Français'
            }
        ];

        // パターンマッチング
        for (const pattern of patterns) {
            if (pattern.regex.test(text)) {
                console.info('[Language Detection] ' + pattern.name + ' 検出', {
                    text: text.substring(0, 30),
                    language: pattern.language
                });
                return pattern.language;
            }
        }

        // デフォルト: 英語
        console.info('[Language Detection] デフォルト English を使用', {
            text: text.substring(0, 30)
        });
        return 'en';
    }

    /**
     * 文本翻译
     *
     * @private
     * @param {string} text 原文
     * @returns {Promise<string>} 翻译文本
     */
    async translateText(text) {
        // OpenAI Chat Completions API を使用
        if (this.app.config.chatModel === null || this.app.config.chatModel === undefined) {
            throw new Error('chatModel が設定されていません');
        }

        const targetLanguage = this.app.config.targetLanguage || 'ja';

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${this.app.config.apiKey}`
            },
            body: JSON.stringify({
                model: this.app.config.chatModel,
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
                temperature: 0.3
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Translation API error: ${response.status} ${errorText}`);
        }

        const data = await response.json();
        return data.choices[0].message.content.trim();
    }

    /**
     * 显示输入文本
     *
     * @private
     * @param {string} text 文本
     * @param {string} language 语言代码
     */
    displayInputText(text, language) {
        if (
            this.app.elements.transcriptOutput === null ||
            this.app.elements.transcriptOutput === undefined
        ) {
            console.warn('[Path1] transcriptOutput 要素が見つかりません');
            return;
        }

        // ✅ 自動検出言語で状態を更新（UI削除後の後替案）
        if (language && language !== 'auto') {
            this.app.state.sourceLang = language;
            console.info('[State] 自動検出言語で sourceLang を更新:', {
                sourceLang: language
            });
        }

        const timestamp = new Date().toLocaleTimeString('ja-JP');
        const languageLabel = language || 'unknown';

        // ✅ 新規: 自動検出言語を UI に表示
        this.updateDetectedLanguageDisplay(language);

        // ✅ 修正: sourceLangDisplay も更新
        this.updateSourceLangDisplay(language);

        const entry = document.createElement('div');
        entry.className = 'transcript-entry';
        entry.innerHTML = `
            <div class="transcript-meta">
                <span class="transcript-time">${timestamp}</span>
                <span class="transcript-lang">[${languageLabel}]</span>
                <span class="transcript-label">入力:</span>
            </div>
            <div class="transcript-text">${this.escapeHtml(text)}</div>
        `;

        this.app.elements.transcriptOutput.appendChild(entry);
        this.app.elements.transcriptOutput.scrollTop =
            this.app.elements.transcriptOutput.scrollHeight;
    }

    /**
     * 自動検出言語を UI に表示
     *
     * @private
     * @param {string} detectedLanguage - 検出した言語コード
     */
    updateDetectedLanguageDisplay(detectedLanguage) {
        const displayElement = this.app.elements.detectedLanguageDisplay;
        const codeElement = this.app.elements.detectedLanguageCode;

        console.info('[UI] updateDetectedLanguageDisplay 呼び出し:', {
            detectedLanguage: detectedLanguage,
            displayElementExists: !!displayElement,
            codeElementExists: !!codeElement,
            displayElementId: displayElement ? displayElement.id : 'null'
        });

        // ✅ 要素が見つからない場合は直接取得
        if (!displayElement) {
            const element = document.getElementById('detectedLanguageDisplay');
            if (!element) {
                console.error('[UI] detectedLanguageDisplay 要素が見つかりません');
                return;
            }
            this.app.elements.detectedLanguageDisplay = element;
        }

        if (!codeElement) {
            const element = document.getElementById('detectedLanguageCode');
            if (!element) {
                console.error('[UI] detectedLanguageCode 要素が見つかりません');
                return;
            }
            this.app.elements.detectedLanguageCode = element;
        }

        // 言語コードから言語名へ変換
        const languageNames = {
            ja: '日本語',
            en: 'English',
            zh: '中文',
            ko: '한국어',
            es: 'Español',
            fr: 'Français',
            de: 'Deutsch',
            pt: 'Português',
            auto: '待機中...'
        };

        const languageEmojis = {
            ja: '🇯🇵',
            en: '🇬🇧',
            zh: '🇨🇳',
            ko: '🇰🇷',
            es: '🇪🇸',
            fr: '🇫🇷',
            de: '🇩🇪',
            pt: '🇵🇹'
        };

        const displayName = languageNames[detectedLanguage] || detectedLanguage;
        const emoji = languageEmojis[detectedLanguage] || '❓';

        // ✅ UI を更新
        this.app.elements.detectedLanguageDisplay.textContent = `${emoji} ${displayName}`;
        this.app.elements.detectedLanguageCode.textContent = detectedLanguage || 'auto';

        console.info('[UI] 自動検出言語を表示:', {
            language: detectedLanguage,
            displayName: displayName,
            emoji: emoji,
            elementText: this.app.elements.detectedLanguageDisplay.textContent
        });
    }

    /**
     * ソース言語表示を更新
     *
     * @private
     * @param {string} detectedLanguage - 検出した言語コード
     */
    updateSourceLangDisplay(detectedLanguage) {
        const sourceLangDisplay = this.app.elements.sourceLangDisplay;

        console.info('[UI] updateSourceLangDisplay 呼び出し:', {
            detectedLanguage: detectedLanguage,
            sourceLangDisplayExists: !!sourceLangDisplay
        });

        // ✅ 要素が見つからない場合は直接取得
        let element = sourceLangDisplay;
        if (!element) {
            element = document.getElementById('sourceLangDisplay');
            if (!element) {
                console.error('[UI] sourceLangDisplay 要素が見つかりません');
                return;
            }
            this.app.elements.sourceLangDisplay = element;
        }

        // 言語コードから言語名へ変換
        const languageNames = {
            ja: '日本語',
            en: 'English',
            zh: '中文',
            ko: '한국어',
            es: 'Español',
            fr: 'Français',
            de: 'Deutsch',
            pt: 'Português',
            auto: '🔄 自動'
        };

        const languageEmojis = {
            ja: '🇯🇵',
            en: '🇬🇧',
            zh: '🇨🇳',
            ko: '🇰🇷',
            es: '🇪🇸',
            fr: '🇫🇷',
            de: '🇩🇪',
            pt: '🇵🇹'
        };

        const displayName = languageNames[detectedLanguage] || detectedLanguage;
        const emoji = languageEmojis[detectedLanguage] || '❓';

        // ✅ UI を更新
        element.textContent = `${emoji} ${displayName}`;

        console.info('[UI] ソース言語を表示:', {
            language: detectedLanguage,
            displayName: displayName,
            emoji: emoji,
            elementText: element.textContent
        });
    }

    /**
     * 显示翻译文本
     *
     * @private
     * @param {string} text 翻译文本
     */
    displayTranslatedText(text) {
        if (
            this.app.elements.transcriptOutput === null ||
            this.app.elements.transcriptOutput === undefined
        ) {
            console.warn('[Path1] transcriptOutput 要素が見つかりません');
            return;
        }

        const timestamp = new Date().toLocaleTimeString('ja-JP');
        const targetLanguage = this.app.config.targetLanguage || 'unknown';

        const entry = document.createElement('div');
        entry.className = 'transcript-entry translated';
        entry.innerHTML = `
            <div class="transcript-meta">
                <span class="transcript-time">${timestamp}</span>
                <span class="transcript-lang">[${targetLanguage}]</span>
                <span class="transcript-label">翻訳:</span>
            </div>
            <div class="transcript-text">${this.escapeHtml(text)}</div>
        `;

        this.app.elements.transcriptOutput.appendChild(entry);
        this.app.elements.transcriptOutput.scrollTop =
            this.app.elements.transcriptOutput.scrollHeight;
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

        console.info('[VoicePathProcessor] 初期化完了');
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
        console.info('[VoicePathProcessor] モード設定:', {
            mode: this.mode,
            description: this.mode === 1 ? 'テキスト表示あり' : 'テキスト表示なし'
        });
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

        try {
            console.info('[Path2] 音声処理開始:', {
                segmentId: segment.id,
                mode: this.mode,
                duration: segment.getDuration() + 'ms',
                samples: segment.audioData ? segment.audioData.length : 0
            });

            this.isProcessing = true;

            // ✅ パス1の音声送信完了待機
            console.info('[Path2] Path1の音声送信を待機中...', {
                segmentId: segment.id,
                audioSent: segment.audioSent
            });

            try {
                await segment.waitForAudioSent();
                console.info('[Path2] Path1の音声送信完了、処理を続行', segment.id);
            } catch (error) {
                console.error('[Path2] 音声送信待機タイムアウト:', error);
                throw new Error('Path1の音声送信を待機中にタイムアウト');
            }

            // ❌ 重複送信削除（Path1 已经送信）
            // await this.sendAudioToServer(segment.audioData); // ← 削除

            // 音声翻訳（OpenAI Realtime API）
            // 注意: 現在の実装では、この処理は WebSocket 経由で行われるため
            // ここでは API 呼び出しを待機する必要がある
            const result = await this.voiceToVoice(segment);

            if (result === null || result.audio === null) {
                console.warn('[Path2] 音声翻訳結果が空:', { segmentId: segment.id });
                // 空でも完了マーク
                this.audioQueue.markPathComplete(segment.id, 'path2', {
                    error: 'Empty audio result'
                });
                return;
            }

            console.info('[Path2] 音声翻訳完了:', {
                segmentId: segment.id,
                hasAudio: result.audio !== null,
                hasText: result.text !== null,
                audioLength: result.audio ? result.audio.length : 0
            });

            // 音声再生
            await this.playAudio(result.audio);

            // モード1の場合、テキストも表示
            if (this.mode === 1 && result.text !== null && result.text.trim() !== '') {
                this.displayTranslatedText(result.text);
            }

            // マーク完了
            this.audioQueue.markPathComplete(segment.id, 'path2', {
                audio: result.audio,
                text: result.text
            });

            console.info('[Path2] 処理完了:', { segmentId: segment.id });
        } catch (error) {
            console.error('[Path2] 処理エラー:', {
                segmentId: segment.id,
                error: error.message,
                stack: error.stack
            });

            // エラーでも完了マーク
            this.audioQueue.markPathComplete(segment.id, 'path2', {
                error: error.message
            });
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * 音声 → 音声翻译
     *
     * @private
     * @param {AudioSegment} segment 音声セグメント
     * @returns {Promise<{audio: string|null, text: string|null}>} 翻译結果
     */
    async voiceToVoice(segment) {
        // 使用 OpenAI Realtime API (WebSocket)
        // 通过 VoiceTranslateApp 的现有 WebSocket 连接送信音声

        // 创建 response.create 请求
        const audioOutputEnabled =
            this.app.elements?.audioOutputEnabled?.classList.contains('active') ?? true;
        const modalities = audioOutputEnabled ? ['text', 'audio'] : ['text'];

        console.info('[Path2] Voice-to-Voice 翻訳開始:', {
            segmentId: segment.id,
            modalities: modalities,
            duration: segment.getDuration() + 'ms'
        });

        // 创建 Promise 来待機 WebSocket 响应
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                // ✅ タイムアウト時はリスナーを削除
                if (this.app.state.ws) {
                    this.app.state.ws.removeEventListener('message', unifiedListener);
                }
                reject(new Error('Voice-to-Voice timeout (60s)'));
            }, 60000);

            // ✅ 監聴データ
            let audioData = null;
            let textData = null;
            let responseId = null;

            // ✅ 統合リスナー（重複登録を防止）
            const unifiedListener = (event) => {
                try {
                    const message = JSON.parse(event.data);

                    // Response created
                    if (message.type === 'response.created') {
                        responseId = message.response.id;
                        console.info('[Path2] Response created:', {
                            responseId: responseId,
                            segmentId: segment.id
                        });
                    }

                    // 翻訳テキスト受信
                    if (message.type === 'response.audio_transcript.done') {
                        textData = this.app.currentTranslationText || null;
                        console.info('[Path2] 翻訳テキスト受信:', {
                            segmentId: segment.id,
                            text: textData?.substring(0, 50) + '...'
                        });
                    }

                    // 翻訳音声受信完了
                    if (message.type === 'response.audio.done') {
                        audioData = 'queued'; // 実際の音声データは再生キューにある
                        console.info('[Path2] 翻訳音声受信完了:', {
                            segmentId: segment.id
                        });
                    }

                    // Response 完全完了
                    if (message.type === 'response.done' && message.response.id === responseId) {
                        clearTimeout(timeoutId);
                        
                        // ✅ リスナーを削除
                        if (this.app.state.ws) {
                            this.app.state.ws.removeEventListener('message', unifiedListener);
                        }

                        console.info('[Path2] Response.done 受信、処理完了:', {
                            segmentId: segment.id,
                            responseId: responseId,
                            hasAudio: audioData !== null,
                            hasText: textData !== null
                        });

                        resolve({
                            audio: audioData,
                            text: textData
                        });
                    }
                } catch (error) {
                    console.error('[Path2] WebSocket メッセージ処理エラー:', {
                        error: error.message,
                        segmentId: segment.id
                    });
                }
            };

            // 検証: WebSocket が接続済みか
            if (!this.app.state.ws || this.app.state.ws.readyState !== WebSocket.OPEN) {
                clearTimeout(timeoutId);
                console.error('[Path2] WebSocket が接続されていません:', {
                    wsExists: !!this.app.state.ws,
                    readyState: this.app.state.ws?.readyState
                });
                reject(new Error('WebSocket 未接続または未準備'));
                return;
            }

            // ✅ 単一リスナーを登録
            this.app.state.ws.addEventListener('message', unifiedListener);

            console.info('[Path2] WebSocket リスナー登録完了');

            // 送信 response.create 请求
            const request = {
                type: 'response.create',
                response: {
                    modalities: modalities,
                    instructions: this.app.getInstructions()
                }
            };

            try {
                this.app.sendMessage(request);
                console.info('[Path2] Response.create 送信完了:', {
                    segmentId: segment.id,
                    modalities: modalities
                });
            } catch (error) {
                clearTimeout(timeoutId);
                if (this.app.state.ws) {
                    this.app.state.ws.removeEventListener('message', unifiedListener);
                }
                console.error('[Path2] Response.create 送信エラー:', {
                    error: error.message,
                    segmentId: segment.id
                });
                reject(error);
            }
        });
    }

    /**
     * 音声播放
     *
     * 目的:
     *   翻訳音声を出力設定に基づいて、音声を再生するかどうかを判定
     *
     * 入力:
     *   audioData: Base64エンコードされた音声データ
     *
     * 注意:
     *   「翻訳音声を出力」がOFFの場合は、音声を再生しない
     *
     * @private
     * @param {string} audioData Base64エンコードされた音声データ
     * @returns {Promise<void>}
     */
    async playAudio(audioData) {
        // ✅ 「翻訳音声を出力」設定をチェック
        const audioOutputEnabled =
            this.app.elements?.audioOutputEnabled?.classList.contains('active') ?? true;

        if (!audioOutputEnabled) {
            console.info('[Path2] 翻訳音声を出力がOFFのため、音声再生をスキップします');
            return;
        }

        if (this.app.audioPlaybackQueue === null || this.app.audioPlaybackQueue === undefined) {
            console.warn('[Path2] audioPlaybackQueue が見つかりません');
            return;
        }

        // 音声再生キューに追加
        this.app.audioPlaybackQueue.push(audioData);

        // キューが処理中でなければ、再生開始
        if (!this.app.isPlayingAudio) {
            await this.app.processAudioPlaybackQueue();
        }
    }

    /**
     * 显示翻译文本（模式1のみ）
     *
     * @private
     * @param {string} text 翻译文本
     */
    displayTranslatedText(text) {
        if (
            this.app.elements.transcriptOutput === null ||
            this.app.elements.transcriptOutput === undefined
        ) {
            console.warn('[Path2] transcriptOutput 要素が見つかりません');
            return;
        }

        const timestamp = new Date().toLocaleTimeString('ja-JP');
        const targetLanguage = this.app.config.targetLanguage || 'unknown';

        const entry = document.createElement('div');
        entry.className = 'transcript-entry voice-output';
        entry.innerHTML = `
            <div class="transcript-meta">
                <span class="transcript-time">${timestamp}</span>
                <span class="transcript-lang">[${targetLanguage}]</span>
                <span class="transcript-label">🔊 音声出力:</span>
            </div>
            <div class="transcript-text">${this.escapeHtml(text)}</div>
        `;

        this.app.elements.transcriptOutput.appendChild(entry);
        this.app.elements.transcriptOutput.scrollTop =
            this.app.elements.transcriptOutput.scrollHeight;
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
 * モジュールエクスポート
 */
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { TextPathProcessor, VoicePathProcessor };
}
