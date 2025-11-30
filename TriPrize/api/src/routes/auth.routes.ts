import { Router } from 'express';
import userController from '../controllers/user.controller';
import { validateBody } from '../middleware/validation.middleware';
import { z } from 'zod';

const router = Router();

/**
 * Validation Schemas
 * 目的: 登録リクエストのバリデーション
 * 注意点: 
 *   - Mock認証モード: firebase_tokenを使用
 *   - 本番認証モード: email/passwordを使用
 *   - roleパラメータは両方のモードでサポート（開発環境またはINITIAL_ADMIN_EMAILで制御）
 */
const registerSchema = z.union([
  // Mock認証モード用: firebase_token必須
  z.object({
    firebase_token: z.string().min(1),
    display_name: z.string().min(1),
    email: z.string().email(),
    role: z.enum(['customer', 'admin']).optional(),
  }),
  // 本番認証モード用: email/password必須
  z.object({
    email: z.string().email(),
    password: z.string().min(6, 'Password must be at least 6 characters'),
    display_name: z.string().optional(),
    role: z.enum(['customer', 'admin']).optional(),
  }),
]);

const loginSchema = z.object({
  firebase_token: z.string().min(1),
});

/**
 * Routes
 */
router.post(
  '/register',
  validateBody(registerSchema),
  userController.register
);

router.post(
  '/login',
  validateBody(loginSchema),
  userController.login
);

export default router;
