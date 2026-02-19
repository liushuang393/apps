import { Router } from 'express';
import checkoutRoutes from './checkout';
import entitlementRoutes from './entitlements';
import webhookRoutes from './webhooks';
import adminRoutes from './admin';
import onboardingRoutes from './onboarding';
import paymentIntentRoutes from './payment-intents';
import subscriptionRoutes from './subscriptions';

const router = Router();

/**
 * API ルート
 *
 * 方案1 (Stripe Checkout):
 * - /checkout     — purchase_intent_id <-> Stripe Session マッピング
 *
 * 方案2 (Stripe Elements):
 * - /payment-intents — PaymentIntent 作成・ステータス確認
 *
 * 方案3 (PaymentIntent API):
 * - /subscriptions   — サブスクリプション CRUD（SetupIntent / 作成 / 更新 / キャンセル）
 *
 * 共通:
 * - /entitlements — Entitlement 状態管理 / Unlock Token 検証
 * - /webhooks     — Stripe Webhook 受信（冪等性付き）
 * - /admin        — 商品・価格・顧客・監査ログ管理
 * - /onboarding   — 開発者登録・APIキー管理
 */

router.use('/checkout', checkoutRoutes);
router.use('/payment-intents', paymentIntentRoutes);
router.use('/subscriptions', subscriptionRoutes);
router.use('/entitlements', entitlementRoutes);
router.use('/webhooks', webhookRoutes);
router.use('/admin', adminRoutes);
router.use('/onboarding', onboardingRoutes);

export default router;

