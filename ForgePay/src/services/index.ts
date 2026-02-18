/**
 * サービスエクスポート
 *
 * 薄いレイヤーとして OpenAI 固有ロジックのみを担当。
 * 通貨・クーポン・請求書・GDPR・法的テンプレート・メトリクス・メール通知は
 * 全て Stripe ネイティブ機能に委譲。
 */

export {
  StripeClient,
  stripeClient,
  CreateCheckoutSessionParams,
  CheckoutSessionResult,
  CreateProductParams,
  UpdateProductParams,
  CreatePriceParams,
  CreateRefundParams,
} from './StripeClient';

export {
  StripeClientFactory,
  stripeClientFactory,
  encryptStripeKey,
  decryptStripeKey,
} from './StripeClientFactory';

export {
  TokenService,
  tokenService,
  TokenPayload,
  TokenVerificationResult,
} from './TokenService';

export {
  EntitlementService,
  entitlementService,
  GrantEntitlementParams,
  EntitlementStatusResult,
} from './EntitlementService';

export {
  CheckoutService,
  checkoutService,
  CreateSessionParams,
  CreateSessionResult,
} from './CheckoutService';

export {
  WebhookProcessor,
  webhookProcessor,
  ProcessResult,
} from './WebhookProcessor';

export {
  DeveloperService,
  developerService,
  ApiKeyResult,
  RegistrationResult,
  OnboardingStatus,
} from './DeveloperService';

export {
  CallbackService,
  callbackService,
} from './CallbackService';
