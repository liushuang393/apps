# Requirements Document: ForgePayBridge

## Introduction

ForgePayBridge (フォージペイ) is a SaaS platform that wraps Stripe to provide a turnkey payment solution for OpenAI ChatGPT Apps monetization. The system focuses on External Checkout (Method 1) as the primary approach, enabling developers to monetize their ChatGPT Apps with minimal frontend implementation while providing multi-language, multi-currency, tax, and invoice support out of the box.

## Glossary

- **ForgePayBridge**: The payment integration platform system
- **Checkout_Session**: A Stripe-hosted payment page instance
- **Entitlement**: A granted access right to a product or service
- **Purchase_Intent_ID**: OpenAI's unique identifier for a purchase attempt
- **Unlock_Token**: A short-lived, single-use JWT for verifying successful payment
- **Webhook_Event**: An HTTP callback notification from Stripe about payment events
- **Admin_Dashboard**: The web interface for platform configuration and management
- **ChatGPT_App**: An OpenAI ChatGPT application integrating with ForgePayBridge
- **External_Checkout**: OpenAI's Method 1 payment flow via redirect to external checkout
- **Customer**: An end-user purchasing access to a ChatGPT App
- **Developer**: A ChatGPT App creator using ForgePayBridge
- **Dead_Letter_Queue**: A storage mechanism for failed webhook processing attempts
- **3DS**: Three-Domain Secure authentication for card payments
- **SCA**: Strong Customer Authentication required in certain regions

## Requirements

### Requirement 1: Hosted Checkout Pages

**User Story:** As a Developer, I want to create hosted checkout pages for my products, so that Customers can purchase access without me building payment forms.

#### Acceptance Criteria

1. WHEN a Developer creates a one-time purchase product, THE ForgePayBridge SHALL generate a unique checkout URL
2. WHEN a Customer visits a checkout URL, THE Checkout_Session SHALL display product details, price, and payment form
3. WHEN a Customer completes payment, THE Checkout_Session SHALL redirect to a success URL with the Unlock_Token
4. WHEN a Developer creates a subscription product, THE ForgePayBridge SHALL support recurring billing intervals (monthly, yearly)
5. WHERE a subscription is active, THE ForgePayBridge SHALL automatically charge the Customer at each billing cycle
6. WHEN a checkout page is displayed, THE ForgePayBridge SHALL use Stripe's hosted checkout to handle all card data

### Requirement 2: Entitlement Management

**User Story:** As a Developer, I want automatic entitlement management, so that Customers receive access immediately upon successful payment without manual intervention.

#### Acceptance Criteria

1. WHEN a payment succeeds, THE ForgePayBridge SHALL create an Entitlement record for the Customer
2. WHEN an Entitlement is created, THE ForgePayBridge SHALL associate it with the Purchase_Intent_ID
3. WHEN a subscription renews successfully, THE ForgePayBridge SHALL extend the Entitlement expiration date
4. WHEN a subscription payment fails, THE ForgePayBridge SHALL suspend the Entitlement after the grace period
5. WHEN a refund is processed, THE ForgePayBridge SHALL revoke the associated Entitlement
6. WHEN a chargeback occurs, THE ForgePayBridge SHALL immediately revoke the associated Entitlement
7. THE ForgePayBridge SHALL store Entitlement status (active, suspended, expired, revoked)

### Requirement 3: Webhook Processing and Reliability

**User Story:** As a Developer, I want reliable webhook processing, so that payment events are never lost and entitlements are granted correctly even during system failures.

#### Acceptance Criteria

1. WHEN a Webhook_Event is received, THE ForgePayBridge SHALL verify the Stripe signature before processing
2. IF signature verification fails, THEN THE ForgePayBridge SHALL reject the webhook and return HTTP 401
3. WHEN a valid Webhook_Event is received, THE ForgePayBridge SHALL process it idempotently using the event ID
4. WHEN a Webhook_Event processing fails, THE ForgePayBridge SHALL retry with exponential backoff
5. WHEN a Webhook_Event fails after maximum retries, THE ForgePayBridge SHALL move it to the Dead_Letter_Queue
6. WHEN processing a checkout.session.completed event, THE ForgePayBridge SHALL grant the Entitlement regardless of whether the Customer returned to the success page
7. WHEN processing events, THE ForgePayBridge SHALL handle out-of-order delivery correctly
8. THE ForgePayBridge SHALL log all webhook processing attempts with timestamps and outcomes

### Requirement 4: ChatGPT App Integration (External Checkout)

**User Story:** As a Developer, I want seamless ChatGPT App integration, so that Customers can purchase and unlock features within the chat experience.

#### Acceptance Criteria

1. WHEN a ChatGPT_App initiates a purchase, THE ForgePayBridge SHALL accept the Purchase_Intent_ID from OpenAI
2. WHEN creating a Checkout_Session, THE ForgePayBridge SHALL associate it with the Purchase_Intent_ID
3. WHEN a payment succeeds, THE ForgePayBridge SHALL generate a short-lived Unlock_Token (valid for 5 minutes)
4. WHEN generating an Unlock_Token, THE ForgePayBridge SHALL sign it using JWT with the Purchase_Intent_ID and Entitlement ID
5. THE ForgePayBridge SHALL provide an API endpoint that accepts an Unlock_Token and returns entitlement status
6. WHEN verifying an Unlock_Token, THE ForgePayBridge SHALL validate the signature, expiration, and single-use constraint
7. WHEN an Unlock_Token is used, THE ForgePayBridge SHALL mark it as consumed to prevent reuse
8. IF an Unlock_Token is expired or already used, THEN THE ForgePayBridge SHALL return an error response

### Requirement 5: Admin Dashboard

**User Story:** As a Developer, I want an admin dashboard, so that I can configure products, view payment history, and manage customer issues without writing code.

#### Acceptance Criteria

1. WHEN a Developer logs into the Admin_Dashboard, THE ForgePayBridge SHALL display an overview of recent transactions and revenue
2. THE Admin_Dashboard SHALL allow Developers to create, edit, and archive products
3. THE Admin_Dashboard SHALL allow Developers to create multiple price points per product with different currencies
4. THE Admin_Dashboard SHALL allow Developers to create and manage discount coupons
5. WHEN viewing customer details, THE Admin_Dashboard SHALL display payment history and current entitlements
6. THE Admin_Dashboard SHALL allow Developers to process refunds with a reason code
7. WHEN a refund is processed via the Admin_Dashboard, THE ForgePayBridge SHALL call the Stripe API and revoke the Entitlement
8. THE Admin_Dashboard SHALL display webhook delivery status and allow manual retry of failed events
9. THE Admin_Dashboard SHALL provide audit logs of all administrative actions

### Requirement 6: Multi-Currency Support

**User Story:** As a Developer, I want multi-currency support, so that Customers worldwide can pay in their local currency.

#### Acceptance Criteria

1. WHEN creating a product price, THE ForgePayBridge SHALL allow specification of multiple currency options
2. WHEN a Customer views a checkout page, THE ForgePayBridge SHALL display prices in the Customer's preferred currency
3. THE ForgePayBridge SHALL support at minimum USD, EUR, GBP, JPY, and AUD
4. WHEN displaying prices, THE ForgePayBridge SHALL show the exchange rate reference if converting from base currency
5. WHEN processing payments, THE ForgePayBridge SHALL use Stripe's currency conversion capabilities

### Requirement 7: Tax Handling and Invoicing

**User Story:** As a Developer, I want automatic tax calculation and invoice generation, so that I comply with regional tax requirements without manual accounting.

#### Acceptance Criteria

1. WHEN a Customer provides a billing address, THE ForgePayBridge SHALL calculate applicable taxes (VAT, GST, state tax)
2. WHEN a payment is completed, THE ForgePayBridge SHALL generate an invoice with itemized tax breakdown
3. THE ForgePayBridge SHALL support EU VAT, UK VAT, Australian GST, and US state sales tax
4. WHERE a Customer provides a valid VAT number, THE ForgePayBridge SHALL apply reverse charge mechanism for B2B transactions
5. WHEN an invoice is generated, THE ForgePayBridge SHALL make it available for download in PDF format
6. THE ForgePayBridge SHALL store invoice records for at least 7 years for compliance

### Requirement 8: Security and Fraud Prevention

**User Story:** As a Developer, I want robust security and fraud prevention, so that my payment system is protected from malicious actors and complies with payment industry standards.

#### Acceptance Criteria

1. THE ForgePayBridge SHALL never store or transmit raw card data
2. WHEN processing payments, THE ForgePayBridge SHALL use Stripe's PCI-compliant hosted checkout
3. WHEN a Webhook_Event is received, THE ForgePayBridge SHALL verify the Stripe signature using the webhook secret
4. WHERE 3DS authentication is required, THE ForgePayBridge SHALL enforce it before completing payment
5. WHEN a payment is flagged by Stripe Radar, THE ForgePayBridge SHALL block the transaction and log the fraud indicator
6. THE ForgePayBridge SHALL rate-limit API endpoints to prevent abuse (maximum 100 requests per minute per IP)
7. WHEN storing Customer PII, THE ForgePayBridge SHALL encrypt it at rest using AES-256
8. THE ForgePayBridge SHALL provide GDPR-compliant data export and deletion capabilities

### Requirement 9: Legal Templates

**User Story:** As a Developer, I want customizable legal templates, so that I can quickly deploy compliant terms of service and privacy policies.

#### Acceptance Criteria

1. THE ForgePayBridge SHALL provide default templates for Terms of Service, Privacy Policy, and Refund Policy
2. WHEN a Developer configures their account, THE ForgePayBridge SHALL allow customization of legal templates
3. WHEN a Customer views a checkout page, THE ForgePayBridge SHALL display links to the applicable legal documents
4. THE ForgePayBridge SHALL version legal templates and track which version a Customer agreed to
5. WHEN legal templates are updated, THE ForgePayBridge SHALL notify Developers of the changes

### Requirement 10: API for Entitlement Verification

**User Story:** As a ChatGPT_App, I want a simple API to verify entitlements, so that I can unlock features for paying Customers in real-time.

#### Acceptance Criteria

1. THE ForgePayBridge SHALL provide a REST API endpoint for entitlement verification
2. WHEN the API receives a Purchase_Intent_ID, THE ForgePayBridge SHALL return the current entitlement status
3. WHEN the API receives an Unlock_Token, THE ForgePayBridge SHALL validate it and return entitlement details
4. THE ForgePayBridge SHALL return entitlement expiration timestamps for subscription-based access
5. THE ForgePayBridge SHALL respond to verification requests within 200ms at the 95th percentile
6. IF no entitlement exists for a Purchase_Intent_ID, THEN THE ForgePayBridge SHALL return a clear "not found" response
7. THE ForgePayBridge SHALL require API authentication using API keys with rate limiting

### Requirement 11: Subscription Management

**User Story:** As a Customer, I want to manage my subscriptions, so that I can upgrade, downgrade, or cancel without contacting support.

#### Acceptance Criteria

1. THE ForgePayBridge SHALL provide a customer portal URL for subscription management
2. WHEN a Customer accesses the portal, THE ForgePayBridge SHALL authenticate them via email magic link
3. WHEN viewing the portal, THE Customer SHALL see all active and past subscriptions
4. THE ForgePayBridge SHALL allow Customers to cancel subscriptions with immediate or end-of-period effect
5. WHEN a subscription is cancelled, THE ForgePayBridge SHALL update the Entitlement expiration accordingly
6. THE ForgePayBridge SHALL allow Customers to update payment methods
7. WHERE upgrade/downgrade options exist, THE ForgePayBridge SHALL allow plan changes with prorated billing

### Requirement 12: Refund and Chargeback Handling

**User Story:** As a Developer, I want automated refund and chargeback handling, so that entitlements are correctly revoked and my records stay accurate.

#### Acceptance Criteria

1. WHEN a refund is issued via Stripe or the Admin_Dashboard, THE ForgePayBridge SHALL revoke the associated Entitlement
2. WHEN a partial refund is issued, THE ForgePayBridge SHALL maintain the Entitlement but log the refund amount
3. WHEN a chargeback notification is received, THE ForgePayBridge SHALL immediately revoke the Entitlement
4. WHEN a chargeback is won, THE ForgePayBridge SHALL restore the Entitlement
5. THE ForgePayBridge SHALL notify Developers of chargebacks via email within 1 hour
6. THE ForgePayBridge SHALL track refund and chargeback rates per Developer account

### Requirement 13: Payment Retry Logic

**User Story:** As a Developer, I want automatic payment retry for failed subscriptions, so that temporary payment failures don't result in lost customers.

#### Acceptance Criteria

1. WHEN a subscription payment fails, THE ForgePayBridge SHALL retry using Stripe's Smart Retries
2. WHEN a payment fails, THE ForgePayBridge SHALL notify the Customer via email with a payment update link
3. WHILE retrying payments, THE ForgePayBridge SHALL maintain the Entitlement during the grace period (7 days)
4. IF all retry attempts fail, THEN THE ForgePayBridge SHALL suspend the Entitlement and notify the Customer
5. WHEN a Customer updates their payment method during retry period, THE ForgePayBridge SHALL immediately attempt payment

### Requirement 14: Audit Logging

**User Story:** As a Developer, I want comprehensive audit logs, so that I can investigate payment issues and maintain compliance records.

#### Acceptance Criteria

1. THE ForgePayBridge SHALL log all API requests with timestamp, endpoint, parameters, and response status
2. THE ForgePayBridge SHALL log all webhook events with processing status and retry attempts
3. THE ForgePayBridge SHALL log all entitlement state changes with reason codes
4. THE ForgePayBridge SHALL log all Admin_Dashboard actions with the performing user and timestamp
5. WHEN viewing audit logs, THE Admin_Dashboard SHALL allow filtering by date range, event type, and customer
6. THE ForgePayBridge SHALL retain audit logs for at least 1 year
7. THE ForgePayBridge SHALL allow audit log export in JSON and CSV formats

### Requirement 15: Developer Onboarding

**User Story:** As a new Developer, I want a streamlined onboarding process, so that I can integrate ForgePayBridge quickly without extensive documentation reading.

#### Acceptance Criteria

1. WHEN a Developer signs up, THE ForgePayBridge SHALL guide them through Stripe account connection
2. WHEN Stripe is connected, THE ForgePayBridge SHALL automatically configure webhook endpoints
3. THE ForgePayBridge SHALL provide a quick-start wizard for creating the first product
4. THE ForgePayBridge SHALL generate sample code snippets for ChatGPT App integration
5. THE ForgePayBridge SHALL provide a test mode using Stripe test keys for safe experimentation
6. WHEN in test mode, THE ForgePayBridge SHALL clearly indicate that no real payments will be processed
7. THE ForgePayBridge SHALL provide interactive API documentation with example requests and responses
