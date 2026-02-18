import { Router, Request, Response } from 'express';
import { developerService } from '../services/DeveloperService';
import { AuthenticatedRequest, apiKeyAuth } from '../middleware';
import { encryptStripeKey, stripeClientFactory } from '../services/StripeClientFactory';
import { logger } from '../utils/logger';

const router = Router();

// ==================== Public Routes ====================

/**
 * POST /onboarding/register
 * Register a new developer account
 */
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { email, testMode } = req.body;

    if (!email || typeof email !== 'string') {
      res.status(400).json({ error: 'Email is required' });
      return;
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      res.status(400).json({ error: 'Invalid email format' });
      return;
    }

    const result = await developerService.register(email, {
      testMode: testMode !== false, // Default to test mode
    });

    res.status(201).json({
      message: 'Registration successful',
      developer: {
        id: result.developer.id,
        email: result.developer.email,
        testMode: result.developer.testMode,
        createdAt: result.developer.createdAt,
      },
      apiKey: {
        key: result.apiKey.apiKey,
        prefix: result.apiKey.prefix,
      },
      warning: 'Save your API key now. It will not be shown again.',
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Email already registered') {
      res.status(409).json({ error: 'Email already registered' });
      return;
    }
    logger.error('Error registering developer', { error });
    res.status(500).json({ error: 'Failed to register' });
  }
});

// ==================== Authenticated Routes ====================

/**
 * GET /onboarding/status
 * Get onboarding status for authenticated developer
 */
router.get('/status', apiKeyAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const status = await developerService.getOnboardingStatus(req.developer!.id);

    if (!status) {
      res.status(404).json({ error: 'Developer not found' });
      return;
    }

    res.json({ status });
  } catch (error) {
    logger.error('Error getting onboarding status', { error });
    res.status(500).json({ error: 'Failed to get onboarding status' });
  }
});

/**
 * GET /onboarding/me
 * Get current developer info
 */
router.get('/me', apiKeyAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const developer = req.developer!;

    res.json({
      developer: {
        id: developer.id,
        email: developer.email,
        testMode: developer.testMode,
        stripeConnected: !!developer.stripeAccountId,
        webhookConfigured: !!developer.webhookSecret,
        createdAt: developer.createdAt,
        updatedAt: developer.updatedAt,
      },
    });
  } catch (error) {
    logger.error('Error getting developer info', { error });
    res.status(500).json({ error: 'Failed to get developer info' });
  }
});

/**
 * POST /onboarding/api-key/regenerate
 * API キー再発行（処理中の決済セッションを安全チェック）
 */
router.post('/api-key/regenerate', apiKeyAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await developerService.regenerateApiKey(req.developer!.id);

    const responseBody: Record<string, unknown> = {
      message: 'API key regenerated successfully',
      apiKey: {
        key: result.apiKey,
        prefix: result.prefix,
      },
      warning: result.hasPendingPayments
        ? 'Warning: There were pending checkout sessions when you regenerated. Update your app API key immediately. Your old key is now invalid.'
        : 'Save your new API key now. It will not be shown again. Your old key is now invalid.',
    };

    if (result.hasPendingPayments) {
      responseBody.hasPendingPayments = true;
    }

    res.json(responseBody);
  } catch (error) {
    logger.error('API キー再発行エラー', { error });
    res.status(500).json({ error: 'Failed to regenerate API key' });
  }
});

/**
 * POST /onboarding/forgot-key
 * API キー紛失時の再発行（メール認証）
 * 旧キーはハッシュ化のため取得不可 → 新キーを発行してメール送信
 * セキュリティ: メールが存在しない場合も同レスポンスを返す（ユーザー列挙防止）
 */
router.post('/forgot-key', async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    if (!email || typeof email !== 'string') {
      res.status(400).json({ error: 'email は必須です' });
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      res.status(400).json({ error: 'メールアドレスの形式が不正です' });
      return;
    }

    // 実際の処理はサービス側で行う（メール不存在でも同レスポンス）
    await developerService.forgotApiKey(email);

    res.json({
      message: '登録されているメールアドレスに新しい API キーを送信しました。数分以内に届かない場合は迷惑メールフォルダをご確認ください。',
    });
  } catch (error) {
    logger.error('forgot-key エラー', { error });
    res.status(500).json({ error: '処理に失敗しました' });
  }
});

/**
 * POST /onboarding/mode
 * Switch between test and live mode
 */
router.post('/mode', apiKeyAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { testMode } = req.body;

    if (typeof testMode !== 'boolean') {
      res.status(400).json({ error: 'testMode must be a boolean' });
      return;
    }

    const developer = await developerService.switchMode(req.developer!.id, testMode);

    if (!developer) {
      res.status(404).json({ error: 'Developer not found' });
      return;
    }

    res.json({
      message: `Switched to ${testMode ? 'test' : 'live'} mode`,
      testMode: developer.testMode,
    });
  } catch (error) {
    logger.error('Error switching mode', { error });
    res.status(500).json({ error: 'Failed to switch mode' });
  }
});

/**
 * POST /onboarding/webhook-secret
 * Set webhook secret
 */
router.post('/webhook-secret', apiKeyAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { webhookSecret } = req.body;

    if (!webhookSecret || typeof webhookSecret !== 'string') {
      res.status(400).json({ error: 'webhookSecret is required' });
      return;
    }

    const developer = await developerService.updateSettings(req.developer!.id, {
      webhookSecret,
    });

    if (!developer) {
      res.status(404).json({ error: 'Developer not found' });
      return;
    }

    res.json({
      message: 'Webhook secret configured',
      webhookConfigured: true,
    });
  } catch (error) {
    logger.error('Error setting webhook secret', { error });
    res.status(500).json({ error: 'Failed to set webhook secret' });
  }
});

/**
 * PUT /onboarding/settings
 * 開発者のデフォルト設定を更新（ノーコード決済リンク用）
 * 
 * @body default_success_url  - 決済成功時のデフォルトリダイレクトURL
 * @body default_cancel_url   - 決済キャンセル時のデフォルトリダイレクトURL
 * @body default_locale       - デフォルトロケール（ja, en, zh 等）
 * @body default_currency     - デフォルト通貨（jpy, usd, eur 等）
 * @body default_payment_methods - デフォルト決済方法（["card", "konbini"] 等）
 * @body callback_url         - 決済イベント通知先URL
 * @body company_name         - 会社名/サービス名
 */
router.put('/settings', apiKeyAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      default_success_url,
      default_cancel_url,
      default_locale,
      default_currency,
      default_payment_methods,
      callback_url,
      company_name,
    } = req.body;

    const updateParams: Record<string, any> = {};

    if (default_success_url !== undefined) updateParams.defaultSuccessUrl = default_success_url;
    if (default_cancel_url !== undefined) updateParams.defaultCancelUrl = default_cancel_url;
    if (default_locale !== undefined) updateParams.defaultLocale = default_locale;
    if (default_currency !== undefined) updateParams.defaultCurrency = default_currency;
    if (default_payment_methods !== undefined) updateParams.defaultPaymentMethods = default_payment_methods;
    if (callback_url !== undefined) updateParams.callbackUrl = callback_url;
    if (company_name !== undefined) updateParams.companyName = company_name;

    // バリデーション: ロケール
    const validLocales = ['auto', 'ja', 'en', 'zh', 'ko', 'fr', 'de', 'es', 'it', 'pt', 'nl', 'th', 'vi', 'id', 'ms'];
    if (default_locale && !validLocales.includes(default_locale)) {
      res.status(400).json({ error: `無効なロケール。有効な値: ${validLocales.join(', ')}` });
      return;
    }

    // バリデーション: 決済方法
    const validMethods = ['card', 'konbini', 'customer_balance', 'alipay', 'wechat_pay', 'link'];
    if (default_payment_methods) {
      if (!Array.isArray(default_payment_methods)) {
        res.status(400).json({ error: 'default_payment_methods は配列で指定してください' });
        return;
      }
      const invalid = default_payment_methods.filter((m: string) => !validMethods.includes(m));
      if (invalid.length > 0) {
        res.status(400).json({
          error: `無効な決済方法: ${invalid.join(', ')}。有効な値: ${validMethods.join(', ')}`,
        });
        return;
      }
    }

    const developer = await developerService.updateSettings(req.developer!.id, updateParams);

    if (!developer) {
      res.status(404).json({ error: 'Developer not found' });
      return;
    }

    res.json({
      message: '設定を更新しました',
      settings: {
        default_success_url: developer.defaultSuccessUrl,
        default_cancel_url: developer.defaultCancelUrl,
        default_locale: developer.defaultLocale,
        default_currency: developer.defaultCurrency,
        default_payment_methods: developer.defaultPaymentMethods,
        callback_url: developer.callbackUrl,
        company_name: developer.companyName,
      },
    });
  } catch (error) {
    logger.error('Error updating developer settings', { error });
    res.status(500).json({ error: '設定の更新に失敗しました' });
  }
});

/**
 * GET /onboarding/settings
 * 開発者のデフォルト設定を取得
 */
router.get('/settings', apiKeyAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const developer = req.developer!;

    res.json({
      settings: {
        default_success_url: developer.defaultSuccessUrl,
        default_cancel_url: developer.defaultCancelUrl,
        default_locale: developer.defaultLocale,
        default_currency: developer.defaultCurrency,
        default_payment_methods: developer.defaultPaymentMethods,
        callback_url: developer.callbackUrl,
        company_name: developer.companyName,
        stripe_configured: developer.stripeConfigured,
        stripe_publishable_key: developer.stripePublishableKey ? '••••' + developer.stripePublishableKey.slice(-8) : null,
      },
    });
  } catch (error) {
    logger.error('Error getting developer settings', { error });
    res.status(500).json({ error: '設定の取得に失敗しました' });
  }
});

/**
 * POST /onboarding/stripe/keys
 * 開発者の Stripe APIキーを設定（マルチテナント対応）
 * 
 * これにより開発者は自分の Stripe アカウントで決済を受けられる。
 * キーは AES-256-GCM で暗号化して保存される。
 * 
 * @body stripe_secret_key      - Stripe Secret Key (sk_test_... or sk_live_...)
 * @body stripe_publishable_key - Stripe Publishable Key (pk_test_... or pk_live_...)
 * @body stripe_webhook_secret  - Stripe Webhook Signing Secret (whsec_...)
 */
router.post('/stripe/keys', apiKeyAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { stripe_secret_key, stripe_publishable_key, stripe_webhook_secret } = req.body;

    // バリデーション
    if (!stripe_secret_key || typeof stripe_secret_key !== 'string') {
      res.status(400).json({ error: 'stripe_secret_key は必須です' });
      return;
    }
    if (!stripe_secret_key.startsWith('sk_test_') && !stripe_secret_key.startsWith('sk_live_')) {
      res.status(400).json({ error: 'stripe_secret_key の形式が不正です（sk_test_ または sk_live_ で始まる必要があります）' });
      return;
    }
    if (stripe_publishable_key && !stripe_publishable_key.startsWith('pk_test_') && !stripe_publishable_key.startsWith('pk_live_')) {
      res.status(400).json({ error: 'stripe_publishable_key の形式が不正です' });
      return;
    }

    // Secret Key を暗号化
    const encryptedKey = encryptStripeKey(stripe_secret_key);

    // 更新
    const developer = await developerService.updateSettings(req.developer!.id, {
      stripeSecretKeyEnc: encryptedKey,
      stripePublishableKey: stripe_publishable_key || null,
      stripeWebhookEndpointSecret: stripe_webhook_secret || null,
      stripeConfigured: true,
    });

    // キャッシュをクリア（新しいキーを即座に反映）
    stripeClientFactory.invalidateCache(req.developer!.id);

    if (!developer) {
      res.status(404).json({ error: 'Developer not found' });
      return;
    }

    // テストモードかライブモードかを自動判定
    const isLiveMode = stripe_secret_key.startsWith('sk_live_');

    res.json({
      message: 'Stripe キーを設定しました',
      stripe_configured: true,
      mode: isLiveMode ? 'live' : 'test',
      publishable_key_set: !!stripe_publishable_key,
      webhook_secret_set: !!stripe_webhook_secret,
    });
  } catch (error) {
    logger.error('Error setting Stripe keys', { error });
    res.status(500).json({ error: 'Stripe キーの設定に失敗しました' });
  }
});

/**
 * POST /onboarding/stripe/verify
 * Stripe キーの接続テスト（保存せずに有効性のみ確認）
 */
router.post('/stripe/verify', apiKeyAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { stripe_secret_key } = req.body;

    if (!stripe_secret_key || typeof stripe_secret_key !== 'string') {
      res.status(400).json({ error: 'stripe_secret_key は必須です' });
      return;
    }

    if (!stripe_secret_key.startsWith('sk_test_') && !stripe_secret_key.startsWith('sk_live_')) {
      res.status(400).json({ error: 'stripe_secret_key の形式が不正です' });
      return;
    }

    // Stripe に実際にリクエストして有効性を確認
    const Stripe = require('stripe');
    const stripe = new Stripe(stripe_secret_key, { apiVersion: '2023-10-16' });

    const account = await stripe.accounts.retrieve();

    res.json({
      valid: true,
      mode: stripe_secret_key.startsWith('sk_live_') ? 'live' : 'test',
      account_id: account.id,
      account_email: account.email,
      message: 'Stripe キーは有効です',
    });
  } catch (error: any) {
    if (error?.type === 'StripeAuthenticationError' || error?.statusCode === 401) {
      res.status(400).json({ valid: false, error: 'Stripe キーが無効です。Stripe Dashboard で確認してください。' });
      return;
    }
    logger.error('Stripe キー検証エラー', { error });
    res.status(500).json({ error: 'Stripe キーの検証に失敗しました' });
  }
});

/**
 * POST /onboarding/stripe/connect
 * Connect Stripe account (simplified - in production, use Stripe Connect OAuth)
 */
router.post('/stripe/connect', apiKeyAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { stripeAccountId } = req.body;

    if (!stripeAccountId || typeof stripeAccountId !== 'string') {
      res.status(400).json({ error: 'stripeAccountId is required' });
      return;
    }

    // Validate Stripe account ID format
    if (!stripeAccountId.startsWith('acct_')) {
      res.status(400).json({ error: 'Invalid Stripe account ID format' });
      return;
    }

    const developer = await developerService.connectStripeAccount(
      req.developer!.id,
      stripeAccountId
    );

    if (!developer) {
      res.status(404).json({ error: 'Developer not found' });
      return;
    }

    res.json({
      message: 'Stripe account connected',
      stripeConnected: true,
      stripeAccountId: developer.stripeAccountId,
    });
  } catch (error) {
    logger.error('Error connecting Stripe account', { error });
    res.status(500).json({ error: 'Failed to connect Stripe account' });
  }
});

/**
 * DELETE /onboarding/account
 * Delete developer account
 */
router.delete('/account', apiKeyAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { confirmEmail } = req.body;

    // Require email confirmation for account deletion
    if (confirmEmail !== req.developer!.email) {
      res.status(400).json({ 
        error: 'Please confirm your email address to delete your account' 
      });
      return;
    }

    const deleted = await developerService.deleteAccount(req.developer!.id);

    if (!deleted) {
      res.status(404).json({ error: 'Developer not found' });
      return;
    }

    res.json({
      message: 'Account deleted successfully',
    });
  } catch (error) {
    logger.error('Error deleting account', { error });
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

/**
 * GET /onboarding/quick-start
 * Get quick-start guide data
 */
router.get('/quick-start', apiKeyAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const developer = req.developer!;
    const status = await developerService.getOnboardingStatus(developer.id);

    // Generate code snippets
    const codeSnippets = {
      createCheckout: `
// Create a checkout session
const response = await fetch('${req.protocol}://${req.get('host')}/api/v1/checkout/sessions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': 'YOUR_API_KEY',
  },
  body: JSON.stringify({
    product_id: 'YOUR_PRODUCT_ID',
    price_id: 'YOUR_PRICE_ID',
    purchase_intent_id: 'unique-purchase-id',
    success_url: 'https://your-app.com/success',
    cancel_url: 'https://your-app.com/cancel',
  }),
});

const { checkout_url } = await response.json();
// Redirect user to checkout_url
      `.trim(),

      verifyEntitlement: `
// Verify entitlement after payment
const response = await fetch('${req.protocol}://${req.get('host')}/api/v1/entitlements/verify?unlock_token=TOKEN', {
  headers: {
    'X-API-Key': 'YOUR_API_KEY',
  },
});

const { entitlement } = await response.json();
if (entitlement.status === 'active') {
  // Grant access to the user
}
      `.trim(),

      handleWebhook: `
// Handle Stripe webhooks
app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const event = req.body;
  
  // Forward to ForgePay
  await fetch('${req.protocol}://${req.get('host')}/api/v1/webhooks/stripe', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Stripe-Signature': req.headers['stripe-signature'],
    },
    body: req.body,
  });
  
  res.json({ received: true });
});
      `.trim(),
    };

    res.json({
      developer: {
        id: developer.id,
        email: developer.email,
        testMode: developer.testMode,
      },
      onboardingStatus: status,
      codeSnippets,
      documentation: {
        apiReference: `${req.protocol}://${req.get('host')}/docs/api`,
        webhooks: `${req.protocol}://${req.get('host')}/docs/webhooks`,
        testing: `${req.protocol}://${req.get('host')}/docs/testing`,
      },
    });
  } catch (error) {
    logger.error('Error getting quick-start guide', { error });
    res.status(500).json({ error: 'Failed to get quick-start guide' });
  }
});

export default router;
