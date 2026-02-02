/**
 * Service exports
 * 
 * Services contain business logic and orchestrate operations
 * across multiple repositories and external APIs.
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
  EmailService,
  emailService,
  PaymentFailureNotificationData,
  ChargebackNotificationData,
  SubscriptionCancelledNotificationData,
  WelcomeNotificationData,
} from './EmailService';

export {
  TaxService,
  taxService,
  TaxAddress,
  TaxLineItem,
  TaxCalculationParams,
  TaxCalculationResult,
  TaxBreakdownItem,
  VATValidationResult,
} from './TaxService';

export {
  MagicLinkService,
  magicLinkService,
  MagicLinkPayload,
  PortalSession,
} from './MagicLinkService';

export {
  CurrencyService,
  currencyService,
  SupportedCurrency,
  CurrencyConfig,
  ExchangeRate,
  MultiCurrencyPrice,
  CURRENCY_CONFIGS,
} from './CurrencyService';

export {
  LegalTemplateService,
  legalTemplateService,
  DEFAULT_TEMPLATES,
} from './LegalTemplateService';

export {
  DeveloperService,
  developerService,
  ApiKeyResult,
  RegistrationResult,
  OnboardingStatus,
} from './DeveloperService';

export {
  InvoiceService,
  invoiceService,
  GenerateInvoiceParams,
  InvoicePdfData,
} from './InvoiceService';

export {
  FraudService,
  fraudService,
  FraudRiskLevel,
  FraudCheckResult,
  FraudEvent,
  FraudPreventionSettings,
} from './FraudService';

export {
  GDPRService,
  gdprService,
  GDPRRequest,
  GDPRRequestType,
  GDPRRequestStatus,
  CustomerDataExport,
} from './GDPRService';

export {
  MetricsService,
  metricsService,
  Metric,
  MetricType,
  Alert,
  AlertSeverity,
  MetricAggregation,
  HealthCheck,
  SystemMetrics,
} from './MetricsService';

export {
  CouponService,
  couponService,
  CouponValidationResult,
  ApplyCouponParams,
  CalculatedDiscount,
} from './CouponService';
