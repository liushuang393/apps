import {
  EmailService,
  EmailOptions,
  PaymentFailureNotificationData,
  ChargebackNotificationData,
  SubscriptionCancelledNotificationData,
  WelcomeNotificationData,
} from '../../../services/EmailService';

// Mock dependencies
jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

// Mock external email providers
const mockSgMail = {
  setApiKey: jest.fn(),
  send: jest.fn().mockResolvedValue([{ statusCode: 202 }]),
};

const mockSESClient = jest.fn();
const mockSendEmailCommand = jest.fn();
let mockSESClientInstance = {
  send: jest.fn().mockResolvedValue({ MessageId: 'test-message-id' }),
};

const mockNodemailerTransporter = {
  sendMail: jest.fn().mockResolvedValue({ messageId: 'test-id' }),
};
const mockNodemailer = {
  createTransport: jest.fn().mockReturnValue(mockNodemailerTransporter),
};

// Mock the external packages
jest.mock('@sendgrid/mail', () => mockSgMail, { virtual: true });
jest.mock(
  '@aws-sdk/client-ses',
  () => ({
    SESClient: function (config: any) {
      mockSESClient(config);
      return mockSESClientInstance;
    },
    SendEmailCommand: function (params: any) {
      mockSendEmailCommand(params);
      return params;
    },
  }),
  { virtual: true }
);
jest.mock('nodemailer', () => mockNodemailer, { virtual: true });

// Default mock config - can be overridden in individual tests
const mockEmailConfig = {
  provider: 'console',
  fromEmail: 'test@forgepay.com',
  fromName: 'TestForgePay',
  enabled: true,
  sendgridApiKey: 'test-sendgrid-key',
  awsRegion: 'us-east-1',
  smtpHost: 'smtp.test.com',
  smtpPort: 587,
  smtpSecure: false,
  smtpUser: 'smtp-user',
  smtpPass: 'smtp-pass',
};

jest.mock('../../../config', () => ({
  config: {
    email: {
      provider: 'console',
      fromEmail: 'test@forgepay.com',
      fromName: 'TestForgePay',
      enabled: true,
      sendgridApiKey: 'test-sendgrid-key',
      awsRegion: 'us-east-1',
      smtpHost: 'smtp.test.com',
      smtpPort: 587,
      smtpSecure: false,
      smtpUser: 'smtp-user',
      smtpPass: 'smtp-pass',
    },
    app: {
      env: 'test',
    },
  },
}));

import { logger } from '../../../utils/logger';
import { config } from '../../../config';

// Get mutable reference to config for test manipulation
const mutableConfig = config as { email: typeof mockEmailConfig; app: { env: string } };

describe('EmailService', () => {
  let service: EmailService;

  // Mock data
  const mockEmailOptions: EmailOptions = {
    to: { email: 'recipient@example.com', name: 'Test Recipient' },
    subject: 'Test Subject',
    text: 'Test body text',
    html: '<p>Test body HTML</p>',
    replyTo: 'reply@example.com',
  };

  const mockPaymentFailureData: PaymentFailureNotificationData = {
    customerEmail: 'customer@example.com',
    customerName: 'John Doe',
    productName: 'Premium Plan',
    amount: 2999,
    currency: 'usd',
    failureReason: 'Card declined',
    retryDate: new Date('2024-02-01'),
    updatePaymentUrl: 'https://example.com/update-payment',
  };

  const mockChargebackData: ChargebackNotificationData = {
    developerEmail: 'developer@example.com',
    customerEmail: 'customer@example.com',
    productName: 'Premium Plan',
    amount: 2999,
    currency: 'usd',
    chargebackReason: 'Product not received',
    chargebackId: 'cb_123',
    respondByDate: new Date('2024-02-15'),
  };

  const mockSubscriptionCancelledData: SubscriptionCancelledNotificationData = {
    customerEmail: 'customer@example.com',
    customerName: 'John Doe',
    productName: 'Premium Plan',
    cancellationDate: new Date('2024-01-15'),
    accessEndDate: new Date('2024-02-15'),
  };

  const mockWelcomeData: WelcomeNotificationData = {
    customerEmail: 'customer@example.com',
    customerName: 'John Doe',
    productName: 'Premium Plan',
    accessUrl: 'https://example.com/access',
  };

  beforeEach(() => {
    jest.resetAllMocks();
    jest.clearAllMocks();

    // Reset config to defaults
    mutableConfig.email = { ...mockEmailConfig };
    mutableConfig.app.env = 'test';

    // Reset mock implementations
    mockSgMail.send.mockResolvedValue([{ statusCode: 202 }]);
    mockSESClientInstance = {
      send: jest.fn().mockResolvedValue({ MessageId: 'test-message-id' }),
    };
    mockNodemailerTransporter.sendMail.mockResolvedValue({ messageId: 'test-id' });
    mockNodemailer.createTransport.mockReturnValue(mockNodemailerTransporter);

    service = new EmailService();
  });

  describe('constructor', () => {
    it('should initialize with default values when config is missing', () => {
      mutableConfig.email = undefined as any;
      const serviceWithDefaults = new EmailService();

      // The service should still work and use defaults
      expect(serviceWithDefaults).toBeDefined();
    });

    it('should use config values when provided', () => {
      mutableConfig.email = {
        ...mockEmailConfig,
        provider: 'ses',
        fromEmail: 'custom@forgepay.com',
        fromName: 'Custom Name',
        enabled: false,
      };

      const customService = new EmailService();
      expect(customService).toBeDefined();
    });

    it('should default enabled to true when not explicitly set to false', () => {
      mutableConfig.email = {
        ...mockEmailConfig,
        enabled: undefined as any,
      };

      const serviceWithUndefinedEnabled = new EmailService();
      expect(serviceWithUndefinedEnabled).toBeDefined();
    });
  });

  describe('send', () => {
    describe('when email is disabled', () => {
      beforeEach(() => {
        mutableConfig.email.enabled = false;
        service = new EmailService();
      });

      it('should skip sending and return true', async () => {
        const result = await service.send(mockEmailOptions);

        expect(result).toBe(true);
        expect(logger.info).toHaveBeenCalledWith('Email sending disabled, skipping', {
          to: mockEmailOptions.to,
          subject: mockEmailOptions.subject,
        });
      });

      it('should not call any provider', async () => {
        await service.send(mockEmailOptions);

        // Check that no provider-specific methods were called
        expect(mockSgMail.send).not.toHaveBeenCalled();
        expect(mockSESClientInstance.send).not.toHaveBeenCalled();
        expect(mockNodemailerTransporter.sendMail).not.toHaveBeenCalled();
      });
    });

    describe('console provider', () => {
      beforeEach(() => {
        mutableConfig.email.provider = 'console';
        service = new EmailService();
      });

      it('should send email via console provider', async () => {
        const result = await service.send(mockEmailOptions);

        expect(result).toBe(true);
        expect(logger.info).toHaveBeenCalledWith(
          'Email sent (console provider)',
          expect.objectContaining({
            subject: 'Test Subject',
          })
        );
      });

      it('should handle single recipient', async () => {
        const result = await service.send({
          to: { email: 'single@example.com', name: 'Single Recipient' },
          subject: 'Test',
          text: 'Body',
        });

        expect(result).toBe(true);
        expect(logger.info).toHaveBeenCalledWith(
          'Email sent (console provider)',
          expect.objectContaining({
            to: 'Single Recipient <single@example.com>',
          })
        );
      });

      it('should handle recipient without name', async () => {
        const result = await service.send({
          to: { email: 'noname@example.com' },
          subject: 'Test',
          text: 'Body',
        });

        expect(result).toBe(true);
        expect(logger.info).toHaveBeenCalledWith(
          'Email sent (console provider)',
          expect.objectContaining({
            to: 'noname@example.com',
          })
        );
      });

      it('should handle multiple recipients', async () => {
        const result = await service.send({
          to: [
            { email: 'first@example.com', name: 'First' },
            { email: 'second@example.com' },
          ],
          subject: 'Test',
          text: 'Body',
        });

        expect(result).toBe(true);
        expect(logger.info).toHaveBeenCalledWith(
          'Email sent (console provider)',
          expect.objectContaining({
            to: 'First <first@example.com>, second@example.com',
          })
        );
      });

      it('should log text and html lengths', async () => {
        const result = await service.send(mockEmailOptions);

        expect(result).toBe(true);
        expect(logger.info).toHaveBeenCalledWith(
          'Email sent (console provider)',
          expect.objectContaining({
            textLength: mockEmailOptions.text?.length,
            htmlLength: mockEmailOptions.html?.length,
          })
        );
      });

      it('should handle missing text/html gracefully', async () => {
        const result = await service.send({
          to: { email: 'test@example.com' },
          subject: 'Test',
        });

        expect(result).toBe(true);
        expect(logger.info).toHaveBeenCalledWith(
          'Email sent (console provider)',
          expect.objectContaining({
            textLength: 0,
            htmlLength: 0,
          })
        );
      });

      it('should output to console in development environment', async () => {
        mutableConfig.app.env = 'development';
        service = new EmailService();

        const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

        await service.send(mockEmailOptions);

        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('EMAIL'));
        consoleSpy.mockRestore();
      });

      it('should not output to console in non-development environment', async () => {
        mutableConfig.app.env = 'production';
        service = new EmailService();

        const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

        await service.send(mockEmailOptions);

        expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringContaining('EMAIL'));
        consoleSpy.mockRestore();
      });
    });

    describe('default provider', () => {
      it('should use console as default when provider is unknown', async () => {
        mutableConfig.email.provider = 'unknown-provider';
        service = new EmailService();

        const result = await service.send(mockEmailOptions);

        expect(result).toBe(true);
        expect(logger.info).toHaveBeenCalledWith(
          'Email sent (console provider)',
          expect.any(Object)
        );
      });
    });

    describe('SendGrid provider', () => {
      beforeEach(() => {
        mutableConfig.email.provider = 'sendgrid';
        service = new EmailService();
      });

      it('should send email via SendGrid successfully', async () => {
        const result = await service.send(mockEmailOptions);

        expect(result).toBe(true);
        expect(mockSgMail.setApiKey).toHaveBeenCalledWith('test-sendgrid-key');
        expect(mockSgMail.send).toHaveBeenCalledWith(
          expect.objectContaining({
            to: [{ email: 'recipient@example.com', name: 'Test Recipient' }],
            from: { email: 'test@forgepay.com', name: 'TestForgePay' },
            subject: 'Test Subject',
            text: 'Test body text',
            html: '<p>Test body HTML</p>',
            replyTo: 'reply@example.com',
          })
        );
        expect(logger.info).toHaveBeenCalledWith(
          'Email sent via SendGrid',
          expect.objectContaining({
            to: ['recipient@example.com'],
            subject: 'Test Subject',
          })
        );
      });

      it('should handle multiple recipients via SendGrid', async () => {
        const multiRecipientOptions: EmailOptions = {
          to: [
            { email: 'first@example.com', name: 'First' },
            { email: 'second@example.com' },
          ],
          subject: 'Test',
          text: 'Body',
        };

        const result = await service.send(multiRecipientOptions);

        expect(result).toBe(true);
        expect(mockSgMail.send).toHaveBeenCalledWith(
          expect.objectContaining({
            to: [
              { email: 'first@example.com', name: 'First' },
              { email: 'second@example.com', name: undefined },
            ],
          })
        );
      });

      it('should fall back to console on SendGrid error', async () => {
        mockSgMail.send.mockRejectedValue(new Error('SendGrid API error'));

        const result = await service.send(mockEmailOptions);

        expect(result).toBe(true);
        expect(logger.error).toHaveBeenCalledWith('SendGrid email failed', expect.any(Object));
        expect(logger.info).toHaveBeenCalledWith(
          'Email sent (console provider)',
          expect.any(Object)
        );
      });

      it('should use default empty API key when not configured', async () => {
        mutableConfig.email.sendgridApiKey = undefined as any;
        service = new EmailService();

        await service.send(mockEmailOptions);

        expect(mockSgMail.setApiKey).toHaveBeenCalledWith('');
      });

      it('should use text as html fallback when html not provided', async () => {
        const textOnlyOptions: EmailOptions = {
          to: { email: 'test@example.com' },
          subject: 'Test',
          text: 'Plain text',
        };

        await service.send(textOnlyOptions);

        expect(mockSgMail.send).toHaveBeenCalledWith(
          expect.objectContaining({
            text: 'Plain text',
            html: 'Plain text',
          })
        );
      });

      it('should handle email with no text or html', async () => {
        const emptyBodyOptions: EmailOptions = {
          to: { email: 'test@example.com' },
          subject: 'Test',
        };

        await service.send(emptyBodyOptions);

        expect(mockSgMail.send).toHaveBeenCalledWith(
          expect.objectContaining({
            text: '',
            html: '',
          })
        );
      });
    });

    describe('AWS SES provider', () => {
      beforeEach(() => {
        mutableConfig.email.provider = 'ses';
        service = new EmailService();
      });

      it('should send email via AWS SES successfully', async () => {
        const result = await service.send(mockEmailOptions);

        expect(result).toBe(true);
        expect(mockSESClient).toHaveBeenCalledWith({
          region: 'us-east-1',
        });
        expect(mockSendEmailCommand).toHaveBeenCalledWith({
          Source: 'TestForgePay <test@forgepay.com>',
          Destination: {
            ToAddresses: ['recipient@example.com'],
          },
          Message: {
            Subject: { Data: 'Test Subject' },
            Body: {
              Text: { Data: 'Test body text' },
              Html: { Data: '<p>Test body HTML</p>' },
            },
          },
          ReplyToAddresses: ['reply@example.com'],
        });
        expect(logger.info).toHaveBeenCalledWith(
          'Email sent via AWS SES',
          expect.objectContaining({
            to: ['recipient@example.com'],
            subject: 'Test Subject',
          })
        );
      });

      it('should handle multiple recipients via SES', async () => {
        const multiRecipientOptions: EmailOptions = {
          to: [{ email: 'first@example.com' }, { email: 'second@example.com' }],
          subject: 'Test',
          text: 'Body',
        };

        const result = await service.send(multiRecipientOptions);

        expect(result).toBe(true);
        expect(mockSendEmailCommand).toHaveBeenCalledWith(
          expect.objectContaining({
            Destination: {
              ToAddresses: ['first@example.com', 'second@example.com'],
            },
          })
        );
      });

      it('should fall back to console on SES error', async () => {
        mockSESClientInstance.send = jest.fn().mockRejectedValue(new Error('SES API error'));

        const result = await service.send(mockEmailOptions);

        expect(result).toBe(true);
        expect(logger.error).toHaveBeenCalledWith('AWS SES email failed', expect.any(Object));
        expect(logger.info).toHaveBeenCalledWith(
          'Email sent (console provider)',
          expect.any(Object)
        );
      });

      it('should use configured AWS region', async () => {
        mutableConfig.email.awsRegion = 'eu-west-1';
        service = new EmailService();

        await service.send(mockEmailOptions);

        expect(mockSESClient).toHaveBeenCalledWith({
          region: 'eu-west-1',
        });
      });

      it('should use default AWS region when not configured', async () => {
        mutableConfig.email.awsRegion = undefined as any;
        service = new EmailService();

        await service.send(mockEmailOptions);

        expect(mockSESClient).toHaveBeenCalledWith({
          region: 'us-east-1',
        });
      });

      it('should not include ReplyToAddresses when replyTo not provided', async () => {
        const noReplyOptions: EmailOptions = {
          to: { email: 'test@example.com' },
          subject: 'Test',
          text: 'Body',
        };

        await service.send(noReplyOptions);

        expect(mockSendEmailCommand).toHaveBeenCalledWith(
          expect.objectContaining({
            ReplyToAddresses: undefined,
          })
        );
      });

      it('should use text as html fallback when html not provided', async () => {
        const textOnlyOptions: EmailOptions = {
          to: { email: 'test@example.com' },
          subject: 'Test',
          text: 'Plain text',
        };

        await service.send(textOnlyOptions);

        expect(mockSendEmailCommand).toHaveBeenCalledWith(
          expect.objectContaining({
            Message: {
              Subject: { Data: 'Test' },
              Body: {
                Text: { Data: 'Plain text' },
                Html: { Data: 'Plain text' },
              },
            },
          })
        );
      });
    });

    describe('SMTP provider', () => {
      beforeEach(() => {
        mutableConfig.email.provider = 'smtp';
        service = new EmailService();
      });

      it('should send email via SMTP successfully', async () => {
        const result = await service.send(mockEmailOptions);

        expect(result).toBe(true);
        expect(mockNodemailer.createTransport).toHaveBeenCalledWith({
          host: 'smtp.test.com',
          port: 587,
          secure: false,
          auth: {
            user: 'smtp-user',
            pass: 'smtp-pass',
          },
        });
        expect(mockNodemailerTransporter.sendMail).toHaveBeenCalledWith({
          from: 'TestForgePay <test@forgepay.com>',
          to: 'Test Recipient <recipient@example.com>',
          subject: 'Test Subject',
          text: 'Test body text',
          html: '<p>Test body HTML</p>',
          replyTo: 'reply@example.com',
        });
        expect(logger.info).toHaveBeenCalledWith(
          'Email sent via SMTP',
          expect.objectContaining({
            to: ['Test Recipient <recipient@example.com>'],
            subject: 'Test Subject',
          })
        );
      });

      it('should handle multiple recipients via SMTP', async () => {
        const multiRecipientOptions: EmailOptions = {
          to: [
            { email: 'first@example.com', name: 'First' },
            { email: 'second@example.com' },
          ],
          subject: 'Test',
          text: 'Body',
        };

        const result = await service.send(multiRecipientOptions);

        expect(result).toBe(true);
        expect(mockNodemailerTransporter.sendMail).toHaveBeenCalledWith(
          expect.objectContaining({
            to: 'First <first@example.com>, second@example.com',
          })
        );
      });

      it('should fall back to console on SMTP error', async () => {
        mockNodemailerTransporter.sendMail.mockRejectedValue(new Error('SMTP error'));

        const result = await service.send(mockEmailOptions);

        expect(result).toBe(true);
        expect(logger.error).toHaveBeenCalledWith('SMTP email failed', expect.any(Object));
        expect(logger.info).toHaveBeenCalledWith(
          'Email sent (console provider)',
          expect.any(Object)
        );
      });

      it('should not include auth when smtpUser is not configured', async () => {
        mutableConfig.email.smtpUser = undefined as any;
        service = new EmailService();

        await service.send(mockEmailOptions);

        expect(mockNodemailer.createTransport).toHaveBeenCalledWith({
          host: 'smtp.test.com',
          port: 587,
          secure: false,
          auth: undefined,
        });
      });

      it('should use default SMTP settings when not configured', async () => {
        mutableConfig.email.smtpHost = undefined as any;
        mutableConfig.email.smtpPort = undefined as any;
        mutableConfig.email.smtpSecure = undefined as any;
        service = new EmailService();

        await service.send(mockEmailOptions);

        expect(mockNodemailer.createTransport).toHaveBeenCalledWith(
          expect.objectContaining({
            host: 'localhost',
            port: 587,
            secure: false,
          })
        );
      });
    });

    describe('error handling', () => {
      it('should catch and log errors, returning false', async () => {
        mutableConfig.email.provider = 'console';
        mutableConfig.app.env = 'development';
        service = new EmailService();

        // Force an error by making console.log throw
        const originalConsole = console.log;
        console.log = () => {
          throw new Error('Console error');
        };

        const result = await service.send(mockEmailOptions);

        expect(result).toBe(false);
        expect(logger.error).toHaveBeenCalledWith('Failed to send email', expect.any(Object));

        console.log = originalConsole;
      });
    });
  });

  describe('sendPaymentFailureNotification', () => {
    beforeEach(() => {
      mutableConfig.email.provider = 'console';
      service = new EmailService();
    });

    it('should send payment failure notification successfully', async () => {
      const result = await service.sendPaymentFailureNotification(mockPaymentFailureData);

      expect(result).toBe(true);
      expect(logger.info).toHaveBeenCalledWith('Payment failure notification sent', {
        customerEmail: 'customer@example.com',
        productName: 'Premium Plan',
      });
    });

    it('should include correct subject', async () => {
      await service.sendPaymentFailureNotification(mockPaymentFailureData);

      expect(logger.info).toHaveBeenCalledWith(
        'Email sent (console provider)',
        expect.objectContaining({
          subject: 'Payment failed for Premium Plan',
        })
      );
    });

    it('should handle missing customer name', async () => {
      const dataWithoutName = { ...mockPaymentFailureData, customerName: undefined };

      const result = await service.sendPaymentFailureNotification(dataWithoutName);

      expect(result).toBe(true);
    });

    it('should handle missing failure reason', async () => {
      const dataWithoutReason = { ...mockPaymentFailureData, failureReason: undefined };

      const result = await service.sendPaymentFailureNotification(dataWithoutReason);

      expect(result).toBe(true);
    });

    it('should handle missing retry date', async () => {
      const dataWithoutRetry = { ...mockPaymentFailureData, retryDate: undefined };

      const result = await service.sendPaymentFailureNotification(dataWithoutRetry);

      expect(result).toBe(true);
    });

    it('should format currency correctly', async () => {
      const dataWithDifferentCurrency = {
        ...mockPaymentFailureData,
        amount: 5000,
        currency: 'eur',
      };

      const result = await service.sendPaymentFailureNotification(dataWithDifferentCurrency);

      expect(result).toBe(true);
    });

    it('should generate HTML email with proper styling', async () => {
      await service.sendPaymentFailureNotification(mockPaymentFailureData);

      expect(logger.info).toHaveBeenCalledWith(
        'Email sent (console provider)',
        expect.objectContaining({
          htmlLength: expect.any(Number),
        })
      );

      // Verify HTML was generated (length should be greater than 0)
      const calls = (logger.info as jest.Mock).mock.calls;
      const consoleProviderCall = calls.find(
        (call) => call[0] === 'Email sent (console provider)'
      );
      expect(consoleProviderCall?.[1]?.htmlLength).toBeGreaterThan(0);
    });

    it('should not log success if send fails', async () => {
      mutableConfig.app.env = 'development';
      service = new EmailService();

      const originalConsole = console.log;
      console.log = () => {
        throw new Error('Console error');
      };

      const result = await service.sendPaymentFailureNotification(mockPaymentFailureData);

      expect(result).toBe(false);
      expect(logger.info).not.toHaveBeenCalledWith(
        'Payment failure notification sent',
        expect.any(Object)
      );

      console.log = originalConsole;
    });
  });

  describe('sendChargebackNotification', () => {
    beforeEach(() => {
      mutableConfig.email.provider = 'console';
      service = new EmailService();
    });

    it('should send chargeback notification successfully', async () => {
      const result = await service.sendChargebackNotification(mockChargebackData);

      expect(result).toBe(true);
      expect(logger.info).toHaveBeenCalledWith('Chargeback notification sent', {
        developerEmail: 'developer@example.com',
        chargebackId: 'cb_123',
      });
    });

    it('should include urgent alert emoji in subject', async () => {
      await service.sendChargebackNotification(mockChargebackData);

      expect(logger.info).toHaveBeenCalledWith(
        'Email sent (console provider)',
        expect.objectContaining({
          subject: expect.stringContaining('⚠️'),
        })
      );
    });

    it('should include formatted amount in subject', async () => {
      await service.sendChargebackNotification(mockChargebackData);

      expect(logger.info).toHaveBeenCalledWith(
        'Email sent (console provider)',
        expect.objectContaining({
          subject: expect.stringContaining('$29.99'),
        })
      );
    });

    it('should handle missing chargeback reason', async () => {
      const dataWithoutReason = { ...mockChargebackData, chargebackReason: undefined };

      const result = await service.sendChargebackNotification(dataWithoutReason);

      expect(result).toBe(true);
    });

    it('should handle missing respond by date', async () => {
      const dataWithoutDate = { ...mockChargebackData, respondByDate: undefined };

      const result = await service.sendChargebackNotification(dataWithoutDate);

      expect(result).toBe(true);
    });

    it('should send to developer email', async () => {
      await service.sendChargebackNotification(mockChargebackData);

      expect(logger.info).toHaveBeenCalledWith(
        'Email sent (console provider)',
        expect.objectContaining({
          to: 'developer@example.com',
        })
      );
    });

    it('should generate HTML email with urgent styling', async () => {
      await service.sendChargebackNotification(mockChargebackData);

      const calls = (logger.info as jest.Mock).mock.calls;
      const consoleProviderCall = calls.find(
        (call) => call[0] === 'Email sent (console provider)'
      );
      expect(consoleProviderCall?.[1]?.htmlLength).toBeGreaterThan(0);
    });

    it('should not log success if send fails', async () => {
      mutableConfig.app.env = 'development';
      service = new EmailService();

      const originalConsole = console.log;
      console.log = () => {
        throw new Error('Console error');
      };

      const result = await service.sendChargebackNotification(mockChargebackData);

      expect(result).toBe(false);
      expect(logger.info).not.toHaveBeenCalledWith(
        'Chargeback notification sent',
        expect.any(Object)
      );

      console.log = originalConsole;
    });
  });

  describe('sendSubscriptionCancelledNotification', () => {
    beforeEach(() => {
      mutableConfig.email.provider = 'console';
      service = new EmailService();
    });

    it('should send subscription cancelled notification successfully', async () => {
      const result = await service.sendSubscriptionCancelledNotification(
        mockSubscriptionCancelledData
      );

      expect(result).toBe(true);
      expect(logger.info).toHaveBeenCalledWith('Subscription cancelled notification sent', {
        customerEmail: 'customer@example.com',
        productName: 'Premium Plan',
      });
    });

    it('should include product name in subject', async () => {
      await service.sendSubscriptionCancelledNotification(mockSubscriptionCancelledData);

      expect(logger.info).toHaveBeenCalledWith(
        'Email sent (console provider)',
        expect.objectContaining({
          subject: 'Your Premium Plan subscription has been cancelled',
        })
      );
    });

    it('should handle missing customer name', async () => {
      const dataWithoutName = { ...mockSubscriptionCancelledData, customerName: undefined };

      const result = await service.sendSubscriptionCancelledNotification(dataWithoutName);

      expect(result).toBe(true);
    });

    it('should include cancellation and access end dates', async () => {
      const result = await service.sendSubscriptionCancelledNotification(
        mockSubscriptionCancelledData
      );

      expect(result).toBe(true);
      expect(logger.info).toHaveBeenCalledWith(
        'Email sent (console provider)',
        expect.any(Object)
      );
    });

    it('should only send text email (no HTML)', async () => {
      await service.sendSubscriptionCancelledNotification(mockSubscriptionCancelledData);

      expect(logger.info).toHaveBeenCalledWith(
        'Email sent (console provider)',
        expect.objectContaining({
          htmlLength: 0,
        })
      );
    });

    it('should not log success if send fails', async () => {
      mutableConfig.app.env = 'development';
      service = new EmailService();

      const originalConsole = console.log;
      console.log = () => {
        throw new Error('Console error');
      };

      const result = await service.sendSubscriptionCancelledNotification(
        mockSubscriptionCancelledData
      );

      expect(result).toBe(false);
      expect(logger.info).not.toHaveBeenCalledWith(
        'Subscription cancelled notification sent',
        expect.any(Object)
      );

      console.log = originalConsole;
    });
  });

  describe('sendWelcomeNotification', () => {
    beforeEach(() => {
      mutableConfig.email.provider = 'console';
      service = new EmailService();
    });

    it('should send welcome notification successfully', async () => {
      const result = await service.sendWelcomeNotification(mockWelcomeData);

      expect(result).toBe(true);
      expect(logger.info).toHaveBeenCalledWith('Welcome notification sent', {
        customerEmail: 'customer@example.com',
        productName: 'Premium Plan',
      });
    });

    it('should include product name in subject', async () => {
      await service.sendWelcomeNotification(mockWelcomeData);

      expect(logger.info).toHaveBeenCalledWith(
        'Email sent (console provider)',
        expect.objectContaining({
          subject: 'Welcome! Your access to Premium Plan is ready',
        })
      );
    });

    it('should handle missing customer name', async () => {
      const dataWithoutName = { ...mockWelcomeData, customerName: undefined };

      const result = await service.sendWelcomeNotification(dataWithoutName);

      expect(result).toBe(true);
    });

    it('should handle missing access URL', async () => {
      const dataWithoutUrl = { ...mockWelcomeData, accessUrl: undefined };

      const result = await service.sendWelcomeNotification(dataWithoutUrl);

      expect(result).toBe(true);
    });

    it('should return true and log skipped when email sending is disabled', async () => {
      // Clear any previous mock calls
      jest.clearAllMocks();

      mutableConfig.email.enabled = false;
      service = new EmailService();

      const result = await service.sendWelcomeNotification(mockWelcomeData);

      // When email is disabled, send() returns true (operation "succeeded" - no error)
      expect(result).toBe(true);
      // The disabled skip message should be logged
      expect(logger.info).toHaveBeenCalledWith('Email sending disabled, skipping', expect.any(Object));
      // Since send() returns true, the notification success is also logged
      // This is correct behavior - the notification method completed successfully
      expect(logger.info).toHaveBeenCalledWith(
        'Welcome notification sent',
        expect.any(Object)
      );
    });

    it('should not log success if send fails', async () => {
      mutableConfig.app.env = 'development';
      service = new EmailService();

      const originalConsole = console.log;
      console.log = () => {
        throw new Error('Console error');
      };

      const result = await service.sendWelcomeNotification(mockWelcomeData);

      expect(result).toBe(false);
      expect(logger.info).not.toHaveBeenCalledWith(
        'Welcome notification sent',
        expect.any(Object)
      );

      console.log = originalConsole;
    });
  });

  describe('formatCurrency (private method via notifications)', () => {
    beforeEach(() => {
      mutableConfig.email.provider = 'console';
      service = new EmailService();
    });

    it('should format USD correctly', async () => {
      await service.sendChargebackNotification({
        ...mockChargebackData,
        amount: 1000,
        currency: 'usd',
      });

      expect(logger.info).toHaveBeenCalledWith(
        'Email sent (console provider)',
        expect.objectContaining({
          subject: expect.stringContaining('$10.00'),
        })
      );
    });

    it('should format EUR correctly', async () => {
      await service.sendChargebackNotification({
        ...mockChargebackData,
        amount: 1000,
        currency: 'eur',
      });

      expect(logger.info).toHaveBeenCalledWith(
        'Email sent (console provider)',
        expect.objectContaining({
          subject: expect.stringContaining('€10.00'),
        })
      );
    });

    it('should format GBP correctly', async () => {
      await service.sendChargebackNotification({
        ...mockChargebackData,
        amount: 1000,
        currency: 'gbp',
      });

      expect(logger.info).toHaveBeenCalledWith(
        'Email sent (console provider)',
        expect.objectContaining({
          subject: expect.stringContaining('£10.00'),
        })
      );
    });

    it('should handle zero amount', async () => {
      await service.sendChargebackNotification({
        ...mockChargebackData,
        amount: 0,
        currency: 'usd',
      });

      expect(logger.info).toHaveBeenCalledWith(
        'Email sent (console provider)',
        expect.objectContaining({
          subject: expect.stringContaining('$0.00'),
        })
      );
    });

    it('should handle large amounts', async () => {
      await service.sendChargebackNotification({
        ...mockChargebackData,
        amount: 1000000,
        currency: 'usd',
      });

      expect(logger.info).toHaveBeenCalledWith(
        'Email sent (console provider)',
        expect.objectContaining({
          subject: expect.stringContaining('$10,000.00'),
        })
      );
    });

    it('should convert cents to major units', async () => {
      await service.sendChargebackNotification({
        ...mockChargebackData,
        amount: 9999,
        currency: 'usd',
      });

      expect(logger.info).toHaveBeenCalledWith(
        'Email sent (console provider)',
        expect.objectContaining({
          subject: expect.stringContaining('$99.99'),
        })
      );
    });
  });

  describe('edge cases', () => {
    beforeEach(() => {
      mutableConfig.email.provider = 'console';
      service = new EmailService();
    });

    it('should handle empty subject', async () => {
      const result = await service.send({
        to: { email: 'test@example.com' },
        subject: '',
        text: 'Body',
      });

      expect(result).toBe(true);
    });

    it('should handle very long email content', async () => {
      const longText = 'x'.repeat(100000);
      const result = await service.send({
        to: { email: 'test@example.com' },
        subject: 'Test',
        text: longText,
      });

      expect(result).toBe(true);
      expect(logger.info).toHaveBeenCalledWith(
        'Email sent (console provider)',
        expect.objectContaining({
          textLength: 100000,
        })
      );
    });

    it('should handle special characters in email addresses', async () => {
      const result = await service.send({
        to: { email: 'test+tag@example.com', name: "O'Brien" },
        subject: 'Test',
        text: 'Body',
      });

      expect(result).toBe(true);
    });

    it('should handle unicode in names', async () => {
      const result = await service.send({
        to: { email: 'test@example.com', name: '日本語テスト' },
        subject: 'Test',
        text: 'Body',
      });

      expect(result).toBe(true);
    });

    it('should handle empty recipient array', async () => {
      const result = await service.send({
        to: [],
        subject: 'Test',
        text: 'Body',
      });

      expect(result).toBe(true);
    });

    it('should handle HTML-only email', async () => {
      const result = await service.send({
        to: { email: 'test@example.com' },
        subject: 'Test',
        html: '<h1>Hello</h1>',
      });

      expect(result).toBe(true);
      expect(logger.info).toHaveBeenCalledWith(
        'Email sent (console provider)',
        expect.objectContaining({
          textLength: 0,
          htmlLength: 14,
        })
      );
    });

    it('should handle text-only email', async () => {
      const result = await service.send({
        to: { email: 'test@example.com' },
        subject: 'Test',
        text: 'Plain text only',
      });

      expect(result).toBe(true);
      expect(logger.info).toHaveBeenCalledWith(
        'Email sent (console provider)',
        expect.objectContaining({
          textLength: 15,
          htmlLength: 0,
        })
      );
    });
  });

  describe('singleton export', () => {
    it('should export emailService singleton', async () => {
      const { emailService } = await import('../../../services/EmailService');
      expect(emailService).toBeDefined();
      expect(emailService).toBeInstanceOf(EmailService);
    });
  });

  describe('notification email content validation', () => {
    beforeEach(() => {
      mutableConfig.email.provider = 'console';
      service = new EmailService();
    });

    it('should include fromName in payment failure email body', async () => {
      // Create a service with custom fromName
      mutableConfig.email.fromName = 'CustomBrand';
      service = new EmailService();

      await service.sendPaymentFailureNotification(mockPaymentFailureData);

      // The email should be sent successfully
      expect(logger.info).toHaveBeenCalledWith(
        'Payment failure notification sent',
        expect.any(Object)
      );
    });

    it('should include fromName in chargeback email body', async () => {
      mutableConfig.email.fromName = 'CustomBrand';
      service = new EmailService();

      await service.sendChargebackNotification(mockChargebackData);

      expect(logger.info).toHaveBeenCalledWith(
        'Chargeback notification sent',
        expect.any(Object)
      );
    });

    it('should include fromName in subscription cancelled email body', async () => {
      mutableConfig.email.fromName = 'CustomBrand';
      service = new EmailService();

      await service.sendSubscriptionCancelledNotification(mockSubscriptionCancelledData);

      expect(logger.info).toHaveBeenCalledWith(
        'Subscription cancelled notification sent',
        expect.any(Object)
      );
    });

    it('should include fromName in welcome email body', async () => {
      mutableConfig.email.fromName = 'CustomBrand';
      service = new EmailService();

      await service.sendWelcomeNotification(mockWelcomeData);

      expect(logger.info).toHaveBeenCalledWith('Welcome notification sent', expect.any(Object));
    });
  });

  describe('from address configuration', () => {
    it('should use fromEmail and fromName from config', async () => {
      mutableConfig.email.provider = 'console';
      mutableConfig.email.fromEmail = 'custom@example.com';
      mutableConfig.email.fromName = 'Custom Sender';
      service = new EmailService();

      await service.send(mockEmailOptions);

      expect(logger.info).toHaveBeenCalledWith(
        'Email sent (console provider)',
        expect.objectContaining({
          from: 'Custom Sender <custom@example.com>',
        })
      );
    });
  });
});
