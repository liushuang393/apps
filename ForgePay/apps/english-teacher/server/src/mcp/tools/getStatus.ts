import { z } from 'zod';
import { getUserStatus } from '../../services/userService';

// ツール入力のバリデーションスキーマ
export const getStatusSchema = z.object({
  user_id: z.string().min(1).describe('ChatGPT ユーザーの識別子'),
});

export type GetStatusInput = z.infer<typeof getStatusSchema>;

export interface GetStatusResult {
  paid: boolean;
  free_questions_used: number;
  free_limit: number;
  remaining_free: number;
  can_ask: boolean;
  plan: 'free' | 'premium';
  message: string;
}

/**
 * get_subscription_status ツールのハンドラー
 * ユーザーの現在のサブスクリプション状態と残り回数を返す
 */
export async function handleGetStatus(input: GetStatusInput): Promise<GetStatusResult> {
  const { user_id } = input;
  const status = await getUserStatus(user_id);

  const plan: 'free' | 'premium' = status.paid ? 'premium' : 'free';

  let message: string;
  if (status.paid) {
    message = '有料プランをご利用中です。無制限に英語教師 AI をご利用いただけます。';
  } else if (status.remaining_free > 0) {
    message = `無料プランをご利用中です。残り ${status.remaining_free} 回の無料質問が使えます（全${status.free_limit}回中）。`;
  } else {
    message =
      '無料回答の上限に達しました。有料プランにアップグレードすると無制限に利用できます。';
  }

  return {
    paid: status.paid,
    free_questions_used: status.free_questions_used,
    free_limit: status.free_limit,
    remaining_free: status.remaining_free,
    can_ask: status.can_ask,
    plan,
    message,
  };
}
