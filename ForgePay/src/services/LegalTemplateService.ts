import {
  LegalTemplateRepository,
  legalTemplateRepository,
  LegalTemplate,
  LegalTemplateType,
  CustomerLegalAcceptance,
  CreateLegalTemplateParams,
  UpdateLegalTemplateParams,
} from '../repositories/LegalTemplateRepository';
import { EmailService, emailService } from './EmailService';
import { CustomerRepository, customerRepository } from '../repositories/CustomerRepository';
import { logger } from '../utils/logger';

/**
 * Default legal templates content
 */
const DEFAULT_TEMPLATES: Record<LegalTemplateType, { title: string; content: string }> = {
  terms_of_service: {
    title: 'Terms of Service',
    content: `# Terms of Service

Last updated: {{effective_date}}

## 1. Acceptance of Terms

By accessing or using our services, you agree to be bound by these Terms of Service.

## 2. Description of Service

We provide payment processing and subscription management services for digital products.

## 3. User Accounts

- You must provide accurate information when creating an account
- You are responsible for maintaining the security of your account
- You must notify us immediately of any unauthorized access

## 4. Payment Terms

- All payments are processed through our secure payment provider
- Prices are displayed in the currency selected at checkout
- Refunds are subject to our refund policy

## 5. Intellectual Property

All content and services are protected by intellectual property laws.

## 6. Limitation of Liability

We are not liable for any indirect, incidental, or consequential damages.

## 7. Changes to Terms

We may update these terms at any time. Continued use constitutes acceptance.

## 8. Contact

For questions about these terms, please contact us.
`,
  },
  privacy_policy: {
    title: 'Privacy Policy',
    content: `# Privacy Policy

Last updated: {{effective_date}}

## 1. Information We Collect

### Personal Information
- Email address
- Name
- Payment information (processed by our payment provider)

### Usage Information
- IP address
- Browser type
- Pages visited

## 2. How We Use Information

- To process payments
- To provide customer support
- To send important notifications
- To improve our services

## 3. Information Sharing

We do not sell your personal information. We may share data with:
- Payment processors (Stripe)
- Service providers who assist our operations

## 4. Data Security

We implement appropriate security measures to protect your data.

## 5. Your Rights

You have the right to:
- Access your personal data
- Request correction of your data
- Request deletion of your data
- Opt out of marketing communications

## 6. Cookies

We use cookies to improve your experience. You can control cookies through your browser settings.

## 7. Contact

For privacy-related questions, please contact us.
`,
  },
  refund_policy: {
    title: 'Refund Policy',
    content: `# Refund Policy

Last updated: {{effective_date}}

## 1. Refund Eligibility

### Digital Products (One-time Purchase)
- Refunds may be requested within 14 days of purchase
- Product must not have been fully consumed or downloaded

### Subscriptions
- You may cancel your subscription at any time
- No refunds for partial billing periods
- Access continues until the end of the billing period

## 2. How to Request a Refund

1. Contact our support team
2. Provide your order ID and reason for refund
3. We will review your request within 3-5 business days

## 3. Refund Processing

- Approved refunds will be processed within 5-10 business days
- Refunds are credited to the original payment method
- Processing time may vary by payment provider

## 4. Non-Refundable Items

- Services that have been fully rendered
- Custom or personalized products
- Products explicitly marked as non-refundable

## 5. Chargebacks

Please contact us before initiating a chargeback. We're happy to resolve issues directly.

## 6. Contact

For refund requests, please contact our support team.
`,
  },
};

/**
 * LegalTemplateService handles legal template operations
 * 
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5
 */
export class LegalTemplateService {
  private templateRepo: LegalTemplateRepository;
  private emailSvc: EmailService;
  private customerRepo: CustomerRepository;

  constructor(
    templateRepo: LegalTemplateRepository = legalTemplateRepository,
    emailSvc: EmailService = emailService,
    customerRepo: CustomerRepository = customerRepository
  ) {
    this.templateRepo = templateRepo;
    this.emailSvc = emailSvc;
    this.customerRepo = customerRepo;
  }

  /**
   * Create a legal template
   */
  async createTemplate(params: CreateLegalTemplateParams): Promise<LegalTemplate> {
    return this.templateRepo.create(params);
  }

  /**
   * Create default templates for a developer
   */
  async createDefaultTemplates(developerId: string): Promise<LegalTemplate[]> {
    const templates: LegalTemplate[] = [];
    const effectiveDate = new Date().toISOString().split('T')[0];

    for (const [type, template] of Object.entries(DEFAULT_TEMPLATES)) {
      const content = template.content.replace('{{effective_date}}', effectiveDate);
      
      const created = await this.templateRepo.create({
        developerId,
        type: type as LegalTemplateType,
        title: template.title,
        content,
        isDefault: true,
      });
      
      templates.push(created);
    }

    logger.info('Default legal templates created', { developerId, count: templates.length });
    return templates;
  }

  /**
   * Get a template by ID
   */
  async getTemplate(id: string): Promise<LegalTemplate | null> {
    return this.templateRepo.findById(id);
  }

  /**
   * Get active template for a developer and type
   */
  async getActiveTemplate(
    developerId: string,
    type: LegalTemplateType
  ): Promise<LegalTemplate | null> {
    return this.templateRepo.findActiveByDeveloperAndType(developerId, type);
  }

  /**
   * Get all active templates for a developer
   */
  async getActiveTemplates(developerId: string): Promise<Record<LegalTemplateType, LegalTemplate | null>> {
    const templates = await this.templateRepo.findByDeveloperId(developerId, { activeOnly: true });
    
    const result: Record<LegalTemplateType, LegalTemplate | null> = {
      terms_of_service: null,
      privacy_policy: null,
      refund_policy: null,
    };

    for (const template of templates) {
      result[template.type] = template;
    }

    return result;
  }

  /**
   * Get all templates for a developer
   */
  async getDeveloperTemplates(
    developerId: string,
    type?: LegalTemplateType
  ): Promise<LegalTemplate[]> {
    return this.templateRepo.findByDeveloperId(developerId, { type });
  }

  /**
   * Get version history for a template type
   */
  async getVersionHistory(
    developerId: string,
    type: LegalTemplateType
  ): Promise<LegalTemplate[]> {
    return this.templateRepo.findVersionHistory(developerId, type);
  }

  /**
   * Update a template (creates a new version if content changes)
   */
  async updateTemplate(
    id: string,
    params: UpdateLegalTemplateParams & { createNewVersion?: boolean }
  ): Promise<LegalTemplate | null> {
    const existing = await this.templateRepo.findById(id);
    if (!existing) {
      return null;
    }

    // If content is changing and createNewVersion is true, create a new version
    if (params.content && params.content !== existing.content && params.createNewVersion) {
      return this.templateRepo.createNewVersion(id, {
        title: params.title,
        content: params.content,
        contentHtml: params.contentHtml,
        effectiveDate: params.effectiveDate,
      });
    }

    // Otherwise, update in place
    return this.templateRepo.update(id, params);
  }

  /**
   * Activate a template version
   */
  async activateTemplate(id: string): Promise<LegalTemplate | null> {
    const template = await this.templateRepo.activate(id);
    
    if (template) {
      // Optionally notify customers about the update
      logger.info('Legal template activated', {
        templateId: id,
        type: template.type,
        version: template.version,
      });
    }

    return template;
  }

  /**
   * Delete a template (only inactive templates with no acceptances)
   */
  async deleteTemplate(id: string): Promise<boolean> {
    return this.templateRepo.delete(id);
  }

  /**
   * Record customer acceptance of legal terms
   */
  async recordAcceptance(
    customerId: string,
    developerId: string,
    types: LegalTemplateType[],
    context: { ipAddress?: string; userAgent?: string }
  ): Promise<CustomerLegalAcceptance[]> {
    const acceptances: CustomerLegalAcceptance[] = [];

    for (const type of types) {
      const template = await this.getActiveTemplate(developerId, type);
      if (!template) {
        logger.warn('No active template for acceptance', { developerId, type });
        continue;
      }

      const acceptance = await this.templateRepo.recordAcceptance({
        customerId,
        templateId: template.id,
        templateType: type,
        templateVersion: template.version,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });

      acceptances.push(acceptance);
    }

    return acceptances;
  }

  /**
   * Get customer's acceptance history
   */
  async getCustomerAcceptances(customerId: string): Promise<CustomerLegalAcceptance[]> {
    return this.templateRepo.getCustomerAcceptances(customerId);
  }

  /**
   * Check if customer has accepted all required legal terms
   */
  async hasAcceptedAllTerms(
    customerId: string,
    developerId: string
  ): Promise<{
    allAccepted: boolean;
    status: Record<LegalTemplateType, boolean>;
  }> {
    const types: LegalTemplateType[] = ['terms_of_service', 'privacy_policy', 'refund_policy'];
    const status: Record<LegalTemplateType, boolean> = {
      terms_of_service: false,
      privacy_policy: false,
      refund_policy: false,
    };

    for (const type of types) {
      status[type] = await this.templateRepo.hasAcceptedLatest(
        customerId,
        developerId,
        type
      );
    }

    const allAccepted = Object.values(status).every(Boolean);
    return { allAccepted, status };
  }

  /**
   * Get public URLs for legal templates (for checkout page)
   */
  async getLegalUrls(
    developerId: string,
    baseUrl: string
  ): Promise<Record<LegalTemplateType, string | null>> {
    const templates = await this.getActiveTemplates(developerId);
    
    return {
      terms_of_service: templates.terms_of_service
        ? `${baseUrl}/legal/${developerId}/terms`
        : null,
      privacy_policy: templates.privacy_policy
        ? `${baseUrl}/legal/${developerId}/privacy`
        : null,
      refund_policy: templates.refund_policy
        ? `${baseUrl}/legal/${developerId}/refund`
        : null,
    };
  }

  /**
   * Notify customers when legal templates are updated
   */
  async notifyTemplateUpdate(
    developerId: string,
    type: LegalTemplateType
  ): Promise<number> {
    // Get all customers for this developer who have made purchases
    const customers = await this.customerRepo.findByDeveloperId(developerId);
    
    let notifiedCount = 0;
    
    for (const customer of customers) {
      try {
        // Check if customer previously accepted this template
        const acceptances = await this.templateRepo.getCustomerAcceptances(customer.id);
        const hasAccepted = acceptances.some(a => a.templateType === type);
        
        if (hasAccepted && customer.email) {
          await this.emailSvc.send({
            to: { email: customer.email, name: customer.name || undefined },
            subject: `Legal Terms Updated - ${this.getTypeDisplayName(type)}`,
            html: this.getLegalUpdateEmailHtml(type, customer.name || customer.email),
            text: this.getLegalUpdateEmailText(type, customer.name || customer.email),
          });
          notifiedCount++;
        }
      } catch (error) {
        logger.error('Failed to notify customer of legal update', {
          error,
          customerId: customer.id,
          type,
        });
      }
    }

    logger.info('Legal update notifications sent', { developerId, type, notifiedCount });
    return notifiedCount;
  }

  /**
   * Get display name for template type
   */
  private getTypeDisplayName(type: LegalTemplateType): string {
    switch (type) {
      case 'terms_of_service': return 'Terms of Service';
      case 'privacy_policy': return 'Privacy Policy';
      case 'refund_policy': return 'Refund Policy';
      default: return type;
    }
  }

  /**
   * Get legal update email HTML
   */
  private getLegalUpdateEmailHtml(type: LegalTemplateType, name: string): string {
    const typeName = this.getTypeDisplayName(type);
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
</head>
<body style="font-family: sans-serif; line-height: 1.6; color: #333;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <h2>Legal Terms Updated</h2>
    <p>Hi ${name},</p>
    <p>We have updated our <strong>${typeName}</strong>. These changes are effective immediately.</p>
    <p>Please review the updated terms at your earliest convenience. Your continued use of our services constitutes acceptance of the updated terms.</p>
    <p>If you have any questions, please don't hesitate to contact us.</p>
    <p>Thank you for your continued trust.</p>
  </div>
</body>
</html>
    `;
  }

  /**
   * Get legal update email text
   */
  private getLegalUpdateEmailText(type: LegalTemplateType, name: string): string {
    const typeName = this.getTypeDisplayName(type);
    return `
Hi ${name},

We have updated our ${typeName}. These changes are effective immediately.

Please review the updated terms at your earliest convenience. Your continued use of our services constitutes acceptance of the updated terms.

If you have any questions, please don't hesitate to contact us.

Thank you for your continued trust.
    `.trim();
  }
}

// Export singleton instance
export const legalTemplateService = new LegalTemplateService();

// Export default templates for reference
export { DEFAULT_TEMPLATES };
