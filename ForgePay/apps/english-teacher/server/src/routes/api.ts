import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { handleAskTeacher } from '../mcp/tools/askTeacher';
import { handleGetStatus } from '../mcp/tools/getStatus';
import { handleCreateCheckout } from '../mcp/tools/createCheckout';

const router = Router();

const askSchema = z.object({
  user_id: z.string().min(1),
  question: z.string().min(1).max(2000),
});

const statusSchema = z.object({
  user_id: z.string().min(1),
});

/**
 * POST /api/ask
 * ウィジェット開発環境から直接呼べる英語質問エンドポイント
 */
router.post('/ask', async (req: Request, res: Response) => {
  const parsed = askSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: '入力値が不正です', details: parsed.error.flatten() });
    return;
  }

  const result = await handleAskTeacher(parsed.data);
  res.status(200).json(result);
});

/**
 * POST /api/status
 * ユーザーのサブスクリプション状態を取得する
 */
router.post('/status', async (req: Request, res: Response) => {
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: '入力値が不正です', details: parsed.error.flatten() });
    return;
  }

  const result = await handleGetStatus(parsed.data);
  res.status(200).json(result);
});

/**
 * POST /api/checkout
 * チェックアウト URL を生成する
 */
router.post('/checkout', async (req: Request, res: Response) => {
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: '入力値が不正です', details: parsed.error.flatten() });
    return;
  }

  const result = await handleCreateCheckout(parsed.data);
  res.status(200).json(result);
});

export default router;
