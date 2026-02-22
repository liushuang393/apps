import { Router, Request, Response } from 'express';
import { markUserAsPaid } from '../services/userService';

const router = Router();

/**
 * ForgePay コールバック受信用のペイロード型
 *
 * ForgePay が Stripe Webhook を処理した後、ここにシンプルな JSON を POST してくる。
 * → 個別アプリが Stripe の Webhook Secret を持つ必要がなくなる。
 */
interface ForgePayCallback {
  event_id: string;
  event_type: string;
  timestamp: string;
  product?: { id: string; name: string; type: string };
  customer?: { email: string; name?: string };
  amount?: { value: number; currency: string; formatted: string };
  metadata?: { purchase_intent_id?: string; session_id?: string };
}

/**
 * POST /callback/forgepay
 *
 * ForgePay が決済完了時に呼び出すエンドポイント。
 * Stripe の複雑な Webhook 署名検証は不要 — ForgePay が代行済み。
 *
 * ForgePay Dashboard の「通知先 URL」に
 *   http://localhost:3002/callback/forgepay
 * を設定すると自動で通知が届く。
 */
router.post('/', async (req: Request, res: Response) => {
  const payload = req.body as ForgePayCallback;

  console.log(`[ForgePay Callback] ${payload.event_type} (${payload.event_id})`);

  try {
    switch (payload.event_type) {
      case 'payment.completed': {
        const userId = payload.metadata?.purchase_intent_id;
        if (!userId) {
          console.error('[ForgePay Callback] purchase_intent_id が見つかりません', payload);
          res.status(400).json({ error: 'purchase_intent_id が必要です' });
          return;
        }

        const sessionId = payload.metadata?.session_id;
        await markUserAsPaid(userId, sessionId);

        console.log(`[ForgePay Callback] ユーザー ${userId} を有料プランに更新しました`);
        break;
      }

      case 'refund.completed': {
        const userId = payload.metadata?.purchase_intent_id;
        if (userId) {
          console.log(`[ForgePay Callback] 返金通知: ${userId} (未実装: 有料→無料への戻しは要件次第)`);
        }
        break;
      }

      default:
        console.log(`[ForgePay Callback] 未処理のイベント: ${payload.event_type}`);
    }

    res.status(200).json({ received: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[ForgePay Callback] 処理エラー:`, message);
    res.status(200).json({ received: true, error: message });
  }
});

export default router;
