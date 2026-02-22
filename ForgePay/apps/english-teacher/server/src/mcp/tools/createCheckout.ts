import { z } from 'zod';
import { createPayment } from '../../services/forgePayService';
import { savePaymentSession, getUserStatus } from '../../services/userService';

export const createCheckoutSchema = z.object({
  user_id: z.string().min(1).describe('ChatGPT ユーザーの識別子'),
});

export type CreateCheckoutInput = z.infer<typeof createCheckoutSchema>;

export interface CreateCheckoutResult {
  already_paid: boolean;
  checkout_url?: string;
  session_id?: string;
  message: string;
}

/**
 * create_checkout_url ツールのハンドラー
 * ForgePay 経由で決済セッションを作成して URL を返す
 */
export async function handleCreateCheckout(
  input: CreateCheckoutInput,
): Promise<CreateCheckoutResult> {
  const { user_id } = input;

  const status = await getUserStatus(user_id);
  if (status.paid) {
    return {
      already_paid: true,
      message: 'すでに有料プランをご利用中です。全機能をご利用いただけます。',
    };
  }

  // ForgePay に決済を依頼（商品・URL は ForgePay 側のデフォルト設定を使用）
  const checkout = await createPayment(user_id);
  await savePaymentSession(user_id, checkout.session_id);

  return {
    already_paid: false,
    checkout_url: checkout.checkout_url,
    session_id: checkout.session_id,
    message:
      '下のリンクから支払いページに進んでください。支払い完了後、自動的に有料プランが有効になります。',
  };
}
