import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { createPayment } from '../services/forgePayService';
import { savePaymentSession, getUserStatus } from '../services/userService';

const router = Router();

const createSessionSchema = z.object({
  user_id: z.string().min(1),
});

/**
 * POST /checkout/session
 * ForgePay 経由で決済セッションを作成して URL を返す
 */
router.post('/session', async (req: Request, res: Response) => {
  const parsed = createSessionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: '入力値が不正です', details: parsed.error.flatten() });
    return;
  }

  const { user_id } = parsed.data;

  const status = await getUserStatus(user_id);
  if (status.paid) {
    res.status(200).json({
      already_paid: true,
      message: 'すでに有料プランをご利用中です',
    });
    return;
  }

  // ForgePay に決済を依頼（商品・URL は ForgePay ダッシュボードのデフォルト設定を使用）
  const checkout = await createPayment(user_id);
  await savePaymentSession(user_id, checkout.session_id);

  res.status(200).json({
    already_paid: false,
    session_id: checkout.session_id,
    checkout_url: checkout.checkout_url,
  });
});

/**
 * GET /checkout/success
 * 支払い成功後のリダイレクト先
 */
router.get('/success', async (req: Request, res: Response) => {
  const { session_id, user_id } = req.query;

  res.status(200).json({
    success: true,
    message: '支払いが完了しました！有料プランが有効になりました。ChatGPT に戻ってご利用ください。',
    session_id,
    user_id,
  });
});

/**
 * GET /checkout/cancel
 * 支払いキャンセル後のリダイレクト先
 */
router.get('/cancel', (_req: Request, res: Response) => {
  res.status(200).json({
    success: false,
    message: '支払いがキャンセルされました。ChatGPT に戻って再度お試しください。',
  });
});

export default router;
