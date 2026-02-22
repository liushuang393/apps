import { z } from 'zod';
import { askEnglishTeacher } from '../../services/openaiService';
import {
  getUserStatus,
  incrementFreeCount,
  saveQuestionHistory,
  savePaymentSession,
} from '../../services/userService';
import { createPayment } from '../../services/forgePayService';

export const askTeacherSchema = z.object({
  user_id: z.string().min(1).describe('ChatGPT ユーザーの識別子'),
  question: z
    .string()
    .min(1)
    .max(2000)
    .describe('英語に関する質問（文法、語彙、作文校正など）'),
});

export type AskTeacherInput = z.infer<typeof askTeacherSchema>;

export interface AskTeacherResult {
  answer?: string;
  needs_upgrade: boolean;
  checkout_url?: string;
  remaining_free?: number;
  is_paid_user: boolean;
  message?: string;
}

/**
 * ask_english_teacher ツールのハンドラー
 * - 支払い済みユーザー: 無制限に詳細な回答を提供
 * - 未払いユーザー: FREE_LIMIT 回まで簡潔な回答を提供
 * - 制限超過: ForgePay 経由でアップグレード URL を返す
 */
export async function handleAskTeacher(input: AskTeacherInput): Promise<AskTeacherResult> {
  const { user_id, question } = input;

  const status = await getUserStatus(user_id);

  if (status.paid) {
    const result = await askEnglishTeacher(question, true);
    await saveQuestionHistory(user_id, question, result.answer, true);
    return {
      answer: result.answer,
      needs_upgrade: false,
      is_paid_user: true,
    };
  }

  if (status.can_ask) {
    const result = await askEnglishTeacher(question, false);
    await incrementFreeCount(user_id);
    await saveQuestionHistory(user_id, question, result.answer, false);

    const newRemaining = Math.max(0, status.remaining_free - 1);
    return {
      answer: result.answer,
      needs_upgrade: false,
      is_paid_user: false,
      remaining_free: newRemaining,
      message:
        newRemaining > 0
          ? `残り無料回答: ${newRemaining} 回`
          : '無料枠を使い切りました。続けるには有料プランにアップグレードしてください。',
    };
  }

  // 無料制限超過: ForgePay 経由で決済セッションを作成
  try {
    const checkout = await createPayment(user_id);
    await savePaymentSession(user_id, checkout.session_id);

    return {
      needs_upgrade: true,
      checkout_url: checkout.checkout_url,
      is_paid_user: false,
      message: `無料回答の上限（${status.free_limit}回）に達しました。下のリンクから有料プランにアップグレードすると無制限に利用できます。`,
    };
  } catch {
    return {
      needs_upgrade: true,
      is_paid_user: false,
      message:
        '無料回答の上限に達しました。フル機能を使うには有料プランにアップグレードしてください。',
    };
  }
}
