import { Router } from 'express';
import checkoutRoutes from './checkout';
import entitlementRoutes from './entitlements';
import webhookRoutes from './webhooks';
import adminRoutes from './admin';
import onboardingRoutes from './onboarding';

const router = Router();

/**
 * API ルート（薄いレイヤー）
 *
 * OpenAI 固有ロジックのみ:
 * - /checkout     — purchase_intent_id <-> Stripe Session マッピング
 * - /entitlements — Entitlement 状態管理 / Unlock Token 検証
 * - /webhooks     — Stripe Webhook 受信（冪等性付き）
 * - /admin        — 商品・価格・顧客・監査ログ管理
 * - /onboarding   — 開発者登録・APIキー管理
 *
 * 削除済み（Stripe に委譲）:
 * - /currencies   → Stripe が自動処理
 * - /coupons      → Stripe Coupon / Promotion Code
 * - /invoices     → Stripe Invoicing
 * - /legal        → 外部法的テンプレートサービス
 * - /gdpr         → 外部コンプライアンスツール
 * - /portal       → Stripe Customer Portal
 */

router.use('/checkout', checkoutRoutes);
router.use('/entitlements', entitlementRoutes);
router.use('/webhooks', webhookRoutes);
router.use('/admin', adminRoutes);
router.use('/onboarding', onboardingRoutes);

export default router;
