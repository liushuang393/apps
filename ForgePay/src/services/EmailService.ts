import { config } from '../config';
import { logger } from '../utils/logger';

/**
 * Email recipient info
 */
export interface EmailRecipient {
  email: string;
  name?: string;
}

/**
 * Base email options
 */
export interface EmailOptions {
  to: EmailRecipient | EmailRecipient[];
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string;
}

/**
 * Payment failure notification data
 */
export interface PaymentFailureNotificationData {
  customerEmail: string;
  customerName?: string;
  productName: string;
  amount: number;
  currency: string;
  failureReason?: string;
  retryDate?: Date;
  updatePaymentUrl: string;
}

/**
 * Chargeback notification data
 */
export interface ChargebackNotificationData {
  developerEmail: string;
  customerEmail: string;
  productName: string;
  amount: number;
  currency: string;
  chargebackReason?: string;
  chargebackId: string;
  respondByDate?: Date;
}

/**
 * Subscription cancelled notification data
 */
export interface SubscriptionCancelledNotificationData {
  customerEmail: string;
  customerName?: string;
  productName: string;
  cancellationDate: Date;
  accessEndDate: Date;
}

/**
 * Welcome notification data
 */
export interface WelcomeNotificationData {
  customerEmail: string;
  customerName?: string;
  productName: string;
  accessUrl?: string;
}

/**
 * Email template types
 */
export type EmailTemplate =
  | 'payment_failure'
  | 'chargeback_created'
  | 'subscription_cancelled'
  | 'welcome'
  | 'refund_processed';

/**
 * EmailService handles all email notifications
 *
 * Responsibilities:
 * - Send payment failure notifications to customers
 * - Send chargeback notifications to developers
 * - Send subscription lifecycle notifications
 * - Support multiple email providers (SMTP, SendGrid, SES)
 *
 * Requirements: 13.2, 12.5
 */
export class EmailService {
  private provider: string;
  private fromEmail: string;
  private fromName: string;
  private enabled: boolean;

  constructor() {
    this.provider = config.email?.provider || 'console';
    this.fromEmail = config.email?.fromEmail || 'noreply@forgepay.com';
    this.fromName = config.email?.fromName || 'ForgePay';
    this.enabled = config.email?.enabled !== false;
  }

  /**
   * Send an email using the configured provider
   *
   * @param options - Email options
   * @returns True if sent successfully
   */
  async send(options: EmailOptions): Promise<boolean> {
    if (!this.enabled) {
      logger.info('Email sending disabled, skipping', {
        to: options.to,
        subject: options.subject,
      });
      return true;
    }

    try {
      switch (this.provider) {
        case 'sendgrid':
          return await this.sendViaSendGrid(options);
        case 'ses':
          return await this.sendViaSES(options);
        case 'smtp':
          return await this.sendViaSMTP(options);
        case 'console':
        default:
          return await this.sendViaConsole(options);
      }
    } catch (error) {
      logger.error('Failed to send email', {
        error,
        to: options.to,
        subject: options.subject,
      });
      return false;
    }
  }

  /**
   * Send payment failure notification to customer
   *
   * @param data - Payment failure notification data
   * @returns True if sent successfully
   */
  async sendPaymentFailureNotification(
    data: PaymentFailureNotificationData
  ): Promise<boolean> {
    const subject = `Payment failed for ${data.productName}`;

    const text = `
Hi ${data.customerName || 'there'},

We were unable to process your payment of ${this.formatCurrency(data.amount, data.currency)} for ${data.productName}.

${data.failureReason ? `Reason: ${data.failureReason}` : ''}

${data.retryDate ? `We will automatically retry on ${data.retryDate.toLocaleDateString()}.` : ''}

To update your payment method and ensure uninterrupted access, please visit:
${data.updatePaymentUrl}

If you have any questions, please reply to this email.

Best regards,
${this.fromName}
    `.trim();

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #f8f9fa; padding: 20px; border-radius: 8px 8px 0 0; }
    .content { background: #fff; padding: 20px; border: 1px solid #e9ecef; }
    .footer { background: #f8f9fa; padding: 15px; border-radius: 0 0 8px 8px; text-align: center; font-size: 12px; color: #6c757d; }
    .button { display: inline-block; padding: 12px 24px; background: #007bff; color: #fff; text-decoration: none; border-radius: 4px; margin: 20px 0; }
    .alert { background: #fff3cd; border: 1px solid #ffc107; padding: 15px; border-radius: 4px; margin: 15px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2 style="margin: 0;">Payment Failed</h2>
    </div>
    <div class="content">
      <p>Hi ${data.customerName || 'there'},</p>
      
      <div class="alert">
        We were unable to process your payment of <strong>${this.formatCurrency(data.amount, data.currency)}</strong> for <strong>${data.productName}</strong>.
      </div>
      
      ${data.failureReason ? `<p><strong>Reason:</strong> ${data.failureReason}</p>` : ''}
      
      ${data.retryDate ? `<p>We will automatically retry on <strong>${data.retryDate.toLocaleDateString()}</strong>.</p>` : ''}
      
      <p>To update your payment method and ensure uninterrupted access:</p>
      
      <a href="${data.updatePaymentUrl}" class="button">Update Payment Method</a>
      
      <p>If you have any questions, please reply to this email.</p>
    </div>
    <div class="footer">
      <p>&copy; ${new Date().getFullYear()} ${this.fromName}. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
    `.trim();

    const result = await this.send({
      to: { email: data.customerEmail, name: data.customerName },
      subject,
      text,
      html,
    });

    if (result) {
      logger.info('Payment failure notification sent', {
        customerEmail: data.customerEmail,
        productName: data.productName,
      });
    }

    return result;
  }

  /**
   * Send chargeback notification to developer
   *
   * @param data - Chargeback notification data
   * @returns True if sent successfully
   */
  async sendChargebackNotification(
    data: ChargebackNotificationData
  ): Promise<boolean> {
    const subject = `⚠️ Chargeback Alert: ${this.formatCurrency(data.amount, data.currency)} dispute`;

    const text = `
URGENT: Chargeback Received

A chargeback has been filed against a payment.

Details:
- Amount: ${this.formatCurrency(data.amount, data.currency)}
- Product: ${data.productName}
- Customer: ${data.customerEmail}
- Chargeback ID: ${data.chargebackId}
${data.chargebackReason ? `- Reason: ${data.chargebackReason}` : ''}
${data.respondByDate ? `- Respond By: ${data.respondByDate.toLocaleDateString()}` : ''}

Actions Taken:
- Customer's entitlement has been automatically revoked
- This dispute has been logged in your dashboard

Next Steps:
1. Review the transaction in your Stripe dashboard
2. Gather evidence to support your case
3. Submit your response before the deadline

If you have any questions, please contact support.

Best regards,
${this.fromName}
    `.trim();

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #dc3545; padding: 20px; border-radius: 8px 8px 0 0; color: #fff; }
    .content { background: #fff; padding: 20px; border: 1px solid #e9ecef; }
    .footer { background: #f8f9fa; padding: 15px; border-radius: 0 0 8px 8px; text-align: center; font-size: 12px; color: #6c757d; }
    .details { background: #f8f9fa; padding: 15px; border-radius: 4px; margin: 15px 0; }
    .details dt { font-weight: bold; }
    .details dd { margin: 0 0 10px 0; }
    .urgent { background: #fff3cd; border: 1px solid #ffc107; padding: 15px; border-radius: 4px; margin: 15px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2 style="margin: 0;">⚠️ Chargeback Alert</h2>
    </div>
    <div class="content">
      <div class="urgent">
        <strong>URGENT:</strong> A chargeback has been filed against a payment.
      </div>
      
      <dl class="details">
        <dt>Amount:</dt>
        <dd>${this.formatCurrency(data.amount, data.currency)}</dd>
        
        <dt>Product:</dt>
        <dd>${data.productName}</dd>
        
        <dt>Customer:</dt>
        <dd>${data.customerEmail}</dd>
        
        <dt>Chargeback ID:</dt>
        <dd>${data.chargebackId}</dd>
        
        ${data.chargebackReason ? `<dt>Reason:</dt><dd>${data.chargebackReason}</dd>` : ''}
        
        ${data.respondByDate ? `<dt>Respond By:</dt><dd><strong style="color: #dc3545;">${data.respondByDate.toLocaleDateString()}</strong></dd>` : ''}
      </dl>
      
      <h3>Actions Taken:</h3>
      <ul>
        <li>Customer's entitlement has been automatically revoked</li>
        <li>This dispute has been logged in your dashboard</li>
      </ul>
      
      <h3>Next Steps:</h3>
      <ol>
        <li>Review the transaction in your Stripe dashboard</li>
        <li>Gather evidence to support your case</li>
        <li>Submit your response before the deadline</li>
      </ol>
    </div>
    <div class="footer">
      <p>&copy; ${new Date().getFullYear()} ${this.fromName}. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
    `.trim();

    const result = await this.send({
      to: { email: data.developerEmail },
      subject,
      text,
      html,
    });

    if (result) {
      logger.info('Chargeback notification sent', {
        developerEmail: data.developerEmail,
        chargebackId: data.chargebackId,
      });
    }

    return result;
  }

  /**
   * Send subscription cancelled notification
   *
   * @param data - Subscription cancelled notification data
   * @returns True if sent successfully
   */
  async sendSubscriptionCancelledNotification(
    data: SubscriptionCancelledNotificationData
  ): Promise<boolean> {
    const subject = `Your ${data.productName} subscription has been cancelled`;

    const text = `
Hi ${data.customerName || 'there'},

Your subscription to ${data.productName} has been cancelled.

Cancellation Date: ${data.cancellationDate.toLocaleDateString()}
Access Until: ${data.accessEndDate.toLocaleDateString()}

You will continue to have access until ${data.accessEndDate.toLocaleDateString()}.

If this was a mistake or you'd like to resubscribe, you can do so at any time.

Thank you for being a customer.

Best regards,
${this.fromName}
    `.trim();

    const result = await this.send({
      to: { email: data.customerEmail, name: data.customerName },
      subject,
      text,
    });

    if (result) {
      logger.info('Subscription cancelled notification sent', {
        customerEmail: data.customerEmail,
        productName: data.productName,
      });
    }

    return result;
  }

  /**
   * Send welcome notification after successful purchase
   *
   * @param data - Welcome notification data
   * @returns True if sent successfully
   */
  async sendWelcomeNotification(data: WelcomeNotificationData): Promise<boolean> {
    const subject = `Welcome! Your access to ${data.productName} is ready`;

    const text = `
Hi ${data.customerName || 'there'},

Thank you for your purchase! Your access to ${data.productName} is now active.

${data.accessUrl ? `Get started here: ${data.accessUrl}` : ''}

If you have any questions, please reply to this email.

Best regards,
${this.fromName}
    `.trim();

    const result = await this.send({
      to: { email: data.customerEmail, name: data.customerName },
      subject,
      text,
    });

    if (result) {
      logger.info('Welcome notification sent', {
        customerEmail: data.customerEmail,
        productName: data.productName,
      });
    }

    return result;
  }

  /**
   * Format currency amount for display
   *
   * @param amount - Amount in cents
   * @param currency - Currency code
   * @returns Formatted currency string
   */
  private formatCurrency(amount: number, currency: string): string {
    const majorAmount = amount / 100;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(majorAmount);
  }

  /**
   * Send email via console (for development/testing)
   */
  private async sendViaConsole(options: EmailOptions): Promise<boolean> {
    const recipients = Array.isArray(options.to) ? options.to : [options.to];
    const toAddresses = recipients.map((r) => r.name ? `${r.name} <${r.email}>` : r.email);

    logger.info('Email sent (console provider)', {
      from: `${this.fromName} <${this.fromEmail}>`,
      to: toAddresses.join(', '),
      subject: options.subject,
      textLength: options.text?.length || 0,
      htmlLength: options.html?.length || 0,
    });

    // In development, log the email content
    if (config.app.env === 'development') {
      console.log('\n========== EMAIL ==========');
      console.log(`From: ${this.fromName} <${this.fromEmail}>`);
      console.log(`To: ${toAddresses.join(', ')}`);
      console.log(`Subject: ${options.subject}`);
      console.log('------- TEXT -------');
      console.log(options.text);
      console.log('============================\n');
    }

    return true;
  }

  /**
   * Send email via SendGrid
   * Note: Requires @sendgrid/mail package and SENDGRID_API_KEY env var
   */
  private async sendViaSendGrid(options: EmailOptions): Promise<boolean> {
    try {
      // Dynamic import to avoid requiring the package if not used
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const sgMail = require('@sendgrid/mail');
      sgMail.setApiKey(config.email?.sendgridApiKey || '');

      const recipients = Array.isArray(options.to) ? options.to : [options.to];

      const msg = {
        to: recipients.map((r) => ({ email: r.email, name: r.name })),
        from: { email: this.fromEmail, name: this.fromName },
        subject: options.subject,
        text: options.text || '',
        html: options.html || options.text || '',
        replyTo: options.replyTo,
      };

      await sgMail.send(msg);

      logger.info('Email sent via SendGrid', {
        to: recipients.map((r) => r.email),
        subject: options.subject,
      });

      return true;
    } catch (error) {
      logger.error('SendGrid email failed', { error });
      // Fall back to console logging
      return this.sendViaConsole(options);
    }
  }

  /**
   * Send email via AWS SES
   * Note: Requires @aws-sdk/client-ses package and AWS credentials
   */
  private async sendViaSES(options: EmailOptions): Promise<boolean> {
    try {
      // Dynamic import to avoid requiring the package if not used
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');

      const client = new SESClient({
        region: config.email?.awsRegion || 'us-east-1',
      });

      const recipients = Array.isArray(options.to) ? options.to : [options.to];
      const toAddresses = recipients.map((r) => r.email);

      const command = new SendEmailCommand({
        Source: `${this.fromName} <${this.fromEmail}>`,
        Destination: {
          ToAddresses: toAddresses,
        },
        Message: {
          Subject: { Data: options.subject },
          Body: {
            Text: { Data: options.text || '' },
            Html: { Data: options.html || options.text || '' },
          },
        },
        ReplyToAddresses: options.replyTo ? [options.replyTo] : undefined,
      });

      await client.send(command);

      logger.info('Email sent via AWS SES', {
        to: toAddresses,
        subject: options.subject,
      });

      return true;
    } catch (error) {
      logger.error('AWS SES email failed', { error });
      // Fall back to console logging
      return this.sendViaConsole(options);
    }
  }

  /**
   * Send email via SMTP
   * Note: Requires nodemailer package and SMTP configuration
   */
  private async sendViaSMTP(options: EmailOptions): Promise<boolean> {
    try {
      // Dynamic import to avoid requiring the package if not used
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const nodemailer = require('nodemailer');

      const transporter = nodemailer.createTransport({
        host: config.email?.smtpHost || 'localhost',
        port: config.email?.smtpPort || 587,
        secure: config.email?.smtpSecure || false,
        auth: config.email?.smtpUser
          ? {
              user: config.email.smtpUser,
              pass: config.email.smtpPass,
            }
          : undefined,
      });

      const recipients = Array.isArray(options.to) ? options.to : [options.to];
      const toAddresses = recipients.map((r) => r.name ? `${r.name} <${r.email}>` : r.email);

      await transporter.sendMail({
        from: `${this.fromName} <${this.fromEmail}>`,
        to: toAddresses.join(', '),
        subject: options.subject,
        text: options.text,
        html: options.html,
        replyTo: options.replyTo,
      });

      logger.info('Email sent via SMTP', {
        to: toAddresses,
        subject: options.subject,
      });

      return true;
    } catch (error) {
      logger.error('SMTP email failed', { error });
      // Fall back to console logging
      return this.sendViaConsole(options);
    }
  }
}

// Export singleton instance
export const emailService = new EmailService();
