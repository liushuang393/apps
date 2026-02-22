import OpenAI from 'openai';

// OpenAI クライアントのシングルトン
let openaiClient: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY が設定されていません');
    }
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

// 英語教師としてのシステムプロンプト
const SYSTEM_PROMPT = `You are a friendly and encouraging English teacher. Your goal is to help students improve their English skills.

When answering questions:
- Provide clear, concise explanations
- Give practical examples when helpful
- Correct grammar mistakes gently and constructively
- Encourage the student and build their confidence
- For writing correction tasks, show the corrected version and explain the changes
- Adapt your response level to the student's apparent proficiency

Topics you can help with:
- Grammar explanations and corrections
- Vocabulary building and usage
- Pronunciation guidance (phonetic descriptions)
- Writing improvement (essays, emails, etc.)
- Reading comprehension
- Conversation practice and idioms
- IELTS/TOEIC/TOEFL preparation

Always respond in a warm, supportive tone.`;

export interface AskResult {
  answer: string;
  model: string;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
  };
}

/**
 * OpenAI GPT-4o-mini を使って英語教師として回答を生成する
 * @param question ユーザーの英語に関する質問
 * @param isPaidUser 有料ユーザーかどうか（将来の機能拡張用）
 */
export async function askEnglishTeacher(
  question: string,
  isPaidUser: boolean = false,
): Promise<AskResult> {
  const openai = getOpenAI();

  // 有料ユーザーは詳細な説明、無料ユーザーは簡潔な回答
  const userMessage = isPaidUser
    ? `${question}\n\n(Please provide a detailed explanation with examples.)`
    : question;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userMessage },
    ],
    // 有料ユーザーはより長い回答を許可
    max_tokens: isPaidUser ? 1500 : 600,
    temperature: 0.7,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('OpenAI から回答を取得できませんでした');
  }

  return {
    answer: content,
    model: response.model,
    usage: {
      prompt_tokens: response.usage?.prompt_tokens ?? 0,
      completion_tokens: response.usage?.completion_tokens ?? 0,
    },
  };
}
