import { Router } from 'express';
import userController from '../controllers/user.controller';
import { validateBody } from '../middleware/validation.middleware';
import { rateLimits } from '../middleware/rate-limit.middleware';
import { z } from 'zod';

const router = Router();

/**
 * パスワード強度バリデーション
 * 目的: セキュリティ要件を満たすパスワードを強制
 * 要件:
 *   - 最小8文字
 *   - 大文字を含む
 *   - 小文字を含む
 *   - 数字を含む
 *   - 特殊文字を含む
 */
const passwordSchema = z.string()
  .min(8, 'パスワードは8文字以上必要です')
  .regex(/[A-Z]/, 'パスワードに大文字を含めてください')
  .regex(/[a-z]/, 'パスワードに小文字を含めてください')
  .regex(/[0-9]/, 'パスワードに数字を含めてください')
  .regex(/[!@#$%^&*(),.?":{}|<>_\-+=\[\]\\\/`~';]/, 'パスワードに特殊文字（!@#$%^&*など）を含めてください');

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
    email: z.string().email('有効なメールアドレスを入力してください'),
    role: z.enum(['customer', 'admin']).optional(),
  }),
  // 本番認証モード用: email/password必須
  z.object({
    email: z.string().email('有効なメールアドレスを入力してください'),
    password: passwordSchema,
    display_name: z.string().optional(),
    role: z.enum(['customer', 'admin']).optional(),
  }),
]);

const loginSchema = z.object({
  firebase_token: z.string().min(1),
});

const forgotPasswordSchema = z.object({
  email: z.string().email('有効なメールアドレスを入力してください'),
});

/**
 * Routes
 * 注意点: 認証エンドポイントには厳格なレート制限を適用
 */
router.post(
  '/register',
  rateLimits.auth,
  validateBody(registerSchema),
  userController.register
);

router.post(
  '/login',
  rateLimits.auth,
  validateBody(loginSchema),
  userController.login
);

/**
 * @route   POST /api/auth/forgot-password
 * @desc    Send password reset email
 * @access  Public
 * 目的: パスワードリセットメールを送信
 * 注意点: ブルートフォース攻撃を防ぐためレート制限を適用
 */
router.post(
  '/forgot-password',
  rateLimits.auth,
  validateBody(forgotPasswordSchema),
  userController.forgotPassword
);

export default router;
