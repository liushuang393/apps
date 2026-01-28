/**
 * Repository exports
 * 
 * Repositories handle all database operations for their respective entities.
 * They provide a clean abstraction over the database layer.
 */

export {
  ProductRepository,
  productRepository,
  Product,
  CreateProductParams,
  UpdateProductParams,
} from './ProductRepository';

export {
  PriceRepository,
  priceRepository,
  Price,
  CreatePriceParams,
  UpdatePriceParams,
} from './PriceRepository';

export {
  CustomerRepository,
  customerRepository,
  Customer,
  CreateCustomerParams,
  UpdateCustomerParams,
} from './CustomerRepository';

export {
  EntitlementRepository,
  entitlementRepository,
  Entitlement,
  CreateEntitlementParams,
  UpdateEntitlementParams,
} from './EntitlementRepository';

export {
  WebhookLogRepository,
  webhookLogRepository,
  WebhookLog,
  CreateWebhookLogParams,
  UpdateWebhookLogParams,
} from './WebhookLogRepository';

export {
  AuditLogRepository,
  auditLogRepository,
  AuditLog,
  CreateAuditLogParams,
} from './AuditLogRepository';

export {
  CheckoutSessionRepository,
  checkoutSessionRepository,
  CheckoutSession,
  CreateCheckoutSessionParams,
  UpdateCheckoutSessionParams,
} from './CheckoutSessionRepository';

export {
  LegalTemplateRepository,
  legalTemplateRepository,
  LegalTemplate,
  LegalTemplateType,
  CustomerLegalAcceptance,
  CreateLegalTemplateParams,
  UpdateLegalTemplateParams,
  RecordAcceptanceParams,
} from './LegalTemplateRepository';

export {
  DeveloperRepository,
  developerRepository,
  Developer,
  CreateDeveloperParams,
  UpdateDeveloperParams,
} from './DeveloperRepository';

export {
  InvoiceRepository,
  invoiceRepository,
  Invoice,
  InvoiceStatus,
  InvoiceLineItem,
  CreateInvoiceParams,
} from './InvoiceRepository';

export {
  CouponRepository,
  couponRepository,
  Coupon,
  CouponRedemption,
  DiscountType,
  CreateCouponParams,
  UpdateCouponParams,
  RecordRedemptionParams,
} from './CouponRepository';
