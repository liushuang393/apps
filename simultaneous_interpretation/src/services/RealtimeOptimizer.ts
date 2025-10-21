/**
 * Realtime API 最適化サービス
 *
 * @description
 * OpenAI Realtime API (gpt-realtime-2025-08-28) の最適化設定とベストプラクティス実装
 *
 * @features
 * - 最適化されたプロンプト生成
 * - 音声品質設定
 * - 遅延最適化
 * - エラーハンドリング
 *
 * @reference
 * - https://cookbook.openai.com/examples/realtime_prompting_guide
 * - https://openai.com/index/introducing-gpt-realtime/
 *
 * @author VoiceTranslate Pro Team
 * @version 2.0.0
 */

/**
 * 言語情報
 */
export interface LanguageInfo {
    code: string; // 言語コード (例: 'en', 'ja', 'zh')
    name: string; // 言語名 (例: 'English', 'Japanese', '中文')
    nativeName: string; // ネイティブ名 (例: 'English', '日本語', '中文')
}

/**
 * セッション設定
 */
export interface RealtimeSessionConfig {
    model: string;
    modalities: ('text' | 'audio')[];
    instructions: string;
    voice: string;
    input_audio_format: string;
    output_audio_format: string;
    input_audio_transcription?: {
        model: string;
    };
    turn_detection?: {
        type: string;
        threshold?: number;
        prefix_padding_ms?: number;
        silence_duration_ms?: number;
    };
    temperature?: number;
    max_response_output_tokens?: number;
}

/**
 * 音声設定
 */
export interface VoiceConfig {
    name: string;
    description: string;
    characteristics: string[];
}

/**
 * Realtime API 最適化クラス
 */
export class RealtimeOptimizer {
    /**
     * 推奨モデル
     */
    public static readonly RECOMMENDED_MODEL = 'gpt-realtime-2025-08-28';

    /**
     * 利用可能な音声タイプ (gpt-realtime-2025-08-28)
     */
    public static readonly VOICES: Record<string, VoiceConfig> = {
        // 新しい音声 (gpt-realtime-2025-08-28 専用)
        cedar: {
            name: 'cedar',
            description: '自然で表現力豊かな音声 (新)',
            characteristics: ['natural', 'expressive', 'professional']
        },
        marin: {
            name: 'marin',
            description: '明瞭で親しみやすい音声 (新)',
            characteristics: ['clear', 'friendly', 'warm']
        },
        // 既存の音声 (改善版)
        alloy: {
            name: 'alloy',
            description: 'ニュートラルでバランスの取れた音声',
            characteristics: ['neutral', 'balanced']
        },
        echo: {
            name: 'echo',
            description: '落ち着いた男性的な音声',
            characteristics: ['calm', 'masculine']
        },
        shimmer: {
            name: 'shimmer',
            description: '明るく活発な音声',
            characteristics: ['bright', 'energetic']
        },
        ash: {
            name: 'ash',
            description: '柔らかく穏やかな音声',
            characteristics: ['soft', 'gentle']
        },
        ballad: {
            name: 'ballad',
            description: '温かみのある音声',
            characteristics: ['warm', 'soothing']
        },
        coral: {
            name: 'coral',
            description: '明瞭で自信に満ちた音声',
            characteristics: ['clear', 'confident']
        },
        sage: {
            name: 'sage',
            description: '知的で落ち着いた音声',
            characteristics: ['intelligent', 'composed']
        },
        verse: {
            name: 'verse',
            description: 'リズミカルで表現力豊かな音声',
            characteristics: ['rhythmic', 'expressive']
        }
    };

    /**
     * 最適化されたプロンプトを生成
     *
     * @description
     * OpenAI Realtime Prompting Guide に基づいた最適化されたプロンプト
     *
     * @param sourceLanguage - ソース言語
     * @param targetLanguage - ターゲット言語
     * @param options - オプション設定
     * @returns 最適化されたプロンプト
     */
    public static generateOptimizedPrompt(
        sourceLanguage: LanguageInfo,
        targetLanguage: LanguageInfo,
        options: {
            tone?: 'professional' | 'casual' | 'empathetic';
            pacing?: 'fast' | 'normal' | 'slow';
            preserveEmotion?: boolean;
        } = {}
    ): string {
        const { tone = 'professional', pacing = 'normal', preserveEmotion = true } = options;

        // トーンの説明
        const toneDescriptions = {
            professional: 'Professional and neutral',
            casual: 'Friendly and conversational',
            empathetic: 'Warm and understanding'
        };

        // ペーシングの説明
        const pacingDescriptions = {
            fast: 'Speak quickly and efficiently',
            normal: 'Speak at a natural, conversational pace',
            slow: 'Speak slowly and clearly for better comprehension'
        };

        return `# Role & Objective
You are a professional real-time interpreter specializing in ${sourceLanguage.name} to ${targetLanguage.name} translation.
Your task is to translate speech with high accuracy, natural expression, and appropriate cultural context.

# Personality & Tone
## Personality
- ${toneDescriptions[tone]}
- Clear and articulate
- Culturally aware and sensitive

## Tone
- Maintain the speaker's intent and meaning
${preserveEmotion ? '- Preserve the emotional tone of the original speech' : '- Use a neutral, professional tone'}
- Confident and natural delivery

## Length
- Match the length of the original speech
- Be concise but complete
- Do not add unnecessary words or explanations

## Pacing
- ${pacingDescriptions[pacing]}
- Do not modify the content of your response, only adjust speaking speed
- Maintain clarity and naturalness

## Language
- Input language: ${sourceLanguage.name} (${sourceLanguage.nativeName})
- Output language: ${targetLanguage.name} (${targetLanguage.nativeName}) ONLY
- Do NOT respond in any other language, including ${sourceLanguage.name}
- If the user speaks in an unclear or mixed language, politely ask for clarification in ${targetLanguage.name}

# Instructions / Rules
## Translation Rules
1. **Completeness**: Translate EVERY word and sentence - DO NOT skip or omit anything
2. **Accuracy**: Maintain the original meaning and intent
3. **Naturalness**: Use natural expressions in ${targetLanguage.name}
4. **Cultural Adaptation**: Adapt idioms and cultural references appropriately
5. **Technical Terms**: Preserve technical terms and proper nouns accurately
6. **Numbers and Codes**: When reading numbers or codes, speak each digit clearly and separately

## Forbidden Actions
- DO NOT skip any part of the user's speech
- DO NOT add your own comments, explanations, or meta-text
- DO NOT mix languages in your response
- DO NOT say things like "I will translate", "Here is the translation", or "The translation is"
- DO NOT repeat the original language in your response
- DO NOT ask for confirmation unless the audio is truly unclear

## Unclear Audio Handling
- If the user's audio is not clear (e.g., background noise, silent, unintelligible):
  * Ask for clarification using ${targetLanguage.name} phrases
  * Examples: "Could you repeat that?", "I didn't catch that clearly", "Please speak a bit louder"
- Only respond to clear audio or text

# Conversation Flow
## 1) Listen
- Wait for the user to finish speaking
- Detect natural pauses and sentence boundaries

## 2) Translate
- Immediately translate the complete utterance
- Maintain the flow and rhythm of natural speech

## 3) Deliver
- Speak clearly and naturally in ${targetLanguage.name}
- Match the appropriate tone and emotion

# Sample Phrases
Below are sample examples for inspiration. DO NOT always use these exact phrases - vary your responses naturally.

## Acknowledgements (when needed)
- "I understand"
- "Got it"
- "Noted"

## Clarifications (when audio is unclear)
- "Could you repeat that?"
- "I didn't catch that clearly"
- "Please speak a bit louder"

## Professional Context
- Maintain formality appropriate to the context
- Use polite forms when appropriate in ${targetLanguage.name}

# Example Translation
User (${sourceLanguage.name}): "こんにちは、今日はいい天気ですね。会議を始めましょう。"
You (${targetLanguage.name}): "Hello, it's nice weather today. Let's start the meeting."

User (${sourceLanguage.name}): "プロジェクトの進捗状況を報告します。現在、第一フェーズが完了し、第二フェーズに移行しています。"
You (${targetLanguage.name}): "I'll report on the project progress. Currently, phase one is complete, and we're moving into phase two."

# Critical Reminders
- Translate EVERYTHING the user says - completeness is critical
- Respond ONLY in ${targetLanguage.name} - never use ${sourceLanguage.name} in your response
- Be natural and fluent - avoid robotic or word-for-word translations
- Preserve the speaker's intent and meaning above all else`;
    }

    /**
     * 最適化されたセッション設定を生成
     *
     * @param options - セッションオプション
     * @returns セッション設定
     */
    public static generateSessionConfig(options: {
        sourceLanguage: LanguageInfo;
        targetLanguage: LanguageInfo;
        voice?: string;
        enableAudioOutput?: boolean;
        enableServerVAD?: boolean;
        tone?: 'professional' | 'casual' | 'empathetic';
        pacing?: 'fast' | 'normal' | 'slow';
    }): RealtimeSessionConfig {
        const {
            sourceLanguage,
            targetLanguage,
            voice = 'cedar', // デフォルトは新しい cedar 音声
            enableAudioOutput = true,
            enableServerVAD = true,
            tone = 'professional',
            pacing = 'normal'
        } = options;

        const config: RealtimeSessionConfig = {
            // 最新モデル
            model: this.RECOMMENDED_MODEL,

            // モダリティ: 音声出力の有無
            modalities: enableAudioOutput ? ['text', 'audio'] : ['text'],

            // 最適化されたプロンプト
            instructions: this.generateOptimizedPrompt(sourceLanguage, targetLanguage, {
                tone,
                pacing,
                preserveEmotion: true
            }),

            // 音声タイプ
            voice: voice,

            // 音声フォーマット: PCM16 (最高の互換性)
            input_audio_format: 'pcm16',
            output_audio_format: 'pcm16',

            // 入力音声の転写設定
            input_audio_transcription: {
                model: 'whisper-1'
            },

            // 温度設定: 0.8 (自然な表現とバランス)
            temperature: 0.8,

            // 最大出力トークン数
            max_response_output_tokens: 4096
        };

        // Server VAD 設定
        if (enableServerVAD) {
            config.turn_detection = {
                type: 'server_vad',
                threshold: 0.5,
                prefix_padding_ms: 300,
                silence_duration_ms: 500
            };
        }

        return config;
    }

    /**
     * 音声品質最適化設定
     */
    public static readonly AUDIO_CONFIG = {
        // 採様率: 24kHz (OpenAI 推奨)
        sampleRate: 24000,

        // 音声フォーマット: PCM16
        format: 'pcm16',

        // チャンネル: モノラル
        channels: 1,

        // バッファサイズ設定 (遅延とのトレードオフ)
        bufferSizes: {
            // 超低遅延 (150ms @ 24kHz)
            ultraLow: 3600,
            // 低遅延 (200ms @ 24kHz) - 推奨
            low: 4800,
            // バランス (250ms @ 24kHz)
            balanced: 6000,
            // 高品質 (333ms @ 24kHz)
            high: 8000
        }
    };

    /**
     * VAD (Voice Activity Detection) 最適化設定
     */
    public static readonly VAD_CONFIG = {
        // Server VAD (推奨)
        server: {
            enabled: true,
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 500
        },

        // Client VAD (フォールバック)
        client: {
            // マイク用
            microphone: {
                threshold: 0.004,
                debounce: 250,
                minSpeechMs: 500
            },
            // システム音声用
            system: {
                threshold: 0.01,
                debounce: 350,
                minSpeechMs: 500
            }
        }
    };
}
