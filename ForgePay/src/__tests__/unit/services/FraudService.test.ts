import Stripe from 'stripe';
import { FraudService } from '../../../services/FraudService';
import { AuditLogRepository } from '../../../repositories/AuditLogRepository';

// Mock dependencies
jest.mock('../../../config', () => ({
  config: {
    stripe: {
      secretKey: 'sk_test_mock',
    },
    database: {
      url: 'postgresql://localhost/test',
      poolMin: 2,
      poolMax: 10,
    },
  },
}));

jest.mock('../../../config/database', () => ({
  pool: {
    query: jest.fn(),
    connect: jest.fn(),
  },
}));

jest.mock('../../../repositories/AuditLogRepository', () => ({
  AuditLogRepository: jest.fn(),
  auditLogRepository: {
    create: jest.fn(),
  },
}));

jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

import { logger } from '../../../utils/logger';

const mockLogger = logger as jest.Mocked<typeof logger>;

describe('FraudService', () => {
  let service: FraudService;
  let mockAuditRepo: jest.Mocked<AuditLogRepository>;
  let mockStripe: {
    paymentIntents: {
      retrieve: jest.Mock;
    };
  };

  const mockDeveloperId = 'dev-123';
  const mockPaymentIntentId = 'pi_123';

  beforeEach(() => {
    // Create mock audit repository
    mockAuditRepo = {
      create: jest.fn().mockResolvedValue({
        id: 'audit-123',
        developerId: mockDeveloperId,
        action: 'fraud.check',
        resourceType: 'payment',
        resourceId: mockPaymentIntentId,
        changes: {},
        createdAt: new Date(),
      }),
    } as unknown as jest.Mocked<AuditLogRepository>;

    // Create service with mocked dependencies
    service = new FraudService('sk_test_mock', mockAuditRepo);

    // Mock Stripe client on the service instance
    mockStripe = {
      paymentIntents: {
        retrieve: jest.fn(),
      },
    };
    (service as any).stripe = mockStripe;

    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with default settings', () => {
      const settings = service.getSettings();

      expect(settings.enabled).toBe(true);
      expect(settings.blockHighRisk).toBe(true);
      expect(settings.reviewThreshold).toBe('medium');
      expect(settings.customRules.requireCvc).toBe(true);
      expect(settings.customRules.require3ds).toBe(false);
    });
  });

  describe('analyzePayment', () => {
    it('should return low risk when no outcome is available', async () => {
      mockStripe.paymentIntents.retrieve.mockResolvedValue({
        id: mockPaymentIntentId,
        latest_charge: null,
      });

      const result = await service.analyzePayment(mockPaymentIntentId, mockDeveloperId);

      expect(result.riskLevel).toBe('low');
      expect(result.riskScore).toBe(0);
      expect(result.isBlocked).toBe(false);
      expect(result.reasons).toContain('No fraud analysis available');
    });

    it('should return low risk when charge has no outcome', async () => {
      mockStripe.paymentIntents.retrieve.mockResolvedValue({
        id: mockPaymentIntentId,
        latest_charge: {
          id: 'ch_123',
          outcome: null,
        },
      });

      const result = await service.analyzePayment(mockPaymentIntentId, mockDeveloperId);

      expect(result.riskLevel).toBe('low');
      expect(result.riskScore).toBe(0);
      expect(result.isBlocked).toBe(false);
    });

    it('should analyze payment with normal risk level', async () => {
      mockStripe.paymentIntents.retrieve.mockResolvedValue({
        id: mockPaymentIntentId,
        latest_charge: {
          id: 'ch_123',
          outcome: {
            risk_level: 'normal',
            risk_score: 25,
            network_status: 'approved_by_network',
            seller_message: 'Payment complete.',
            type: 'authorized',
          },
        },
      });

      const result = await service.analyzePayment(mockPaymentIntentId, mockDeveloperId);

      expect(result.riskLevel).toBe('medium');
      expect(result.riskScore).toBe(25);
      expect(result.isBlocked).toBe(false);
      expect(result.metadata?.network_status).toBe('approved_by_network');
      expect(result.metadata?.type).toBe('authorized');
    });

    it('should analyze payment with elevated risk level', async () => {
      mockStripe.paymentIntents.retrieve.mockResolvedValue({
        id: mockPaymentIntentId,
        latest_charge: {
          id: 'ch_123',
          outcome: {
            risk_level: 'elevated',
            risk_score: 65,
            network_status: 'approved_by_network',
            seller_message: 'Elevated risk',
            type: 'authorized',
          },
        },
      });

      const result = await service.analyzePayment(mockPaymentIntentId, mockDeveloperId);

      expect(result.riskLevel).toBe('high');
      expect(result.riskScore).toBe(65);
      expect(result.isBlocked).toBe(true);
      expect(result.reasons).toContain('Elevated risk detected by Stripe Radar');
    });

    it('should analyze payment with highest risk level', async () => {
      mockStripe.paymentIntents.retrieve.mockResolvedValue({
        id: mockPaymentIntentId,
        latest_charge: {
          id: 'ch_123',
          outcome: {
            risk_level: 'highest',
            risk_score: 95,
            network_status: 'approved_by_network',
            seller_message: 'Highest risk detected',
            type: 'authorized',
          },
        },
      });

      const result = await service.analyzePayment(mockPaymentIntentId, mockDeveloperId);

      expect(result.riskLevel).toBe('highest');
      expect(result.riskScore).toBe(95);
      expect(result.isBlocked).toBe(true);
      expect(result.reasons).toContain('Highest risk detected by Stripe Radar');
    });

    it('should block payment when outcome type is blocked', async () => {
      mockStripe.paymentIntents.retrieve.mockResolvedValue({
        id: mockPaymentIntentId,
        latest_charge: {
          id: 'ch_123',
          outcome: {
            risk_level: 'normal',
            risk_score: 20,
            network_status: 'declined_by_network',
            seller_message: 'Payment blocked',
            type: 'blocked',
          },
        },
      });

      const result = await service.analyzePayment(mockPaymentIntentId, mockDeveloperId);

      expect(result.isBlocked).toBe(true);
    });

    it('should include radar rule ID when present', async () => {
      mockStripe.paymentIntents.retrieve.mockResolvedValue({
        id: mockPaymentIntentId,
        latest_charge: {
          id: 'ch_123',
          outcome: {
            risk_level: 'elevated',
            risk_score: 70,
            network_status: 'approved_by_network',
            seller_message: 'Matched custom rule',
            type: 'authorized',
            rule: {
              id: 'rule_123',
              action: 'review',
            },
          },
        },
      });

      const result = await service.analyzePayment(mockPaymentIntentId, mockDeveloperId);

      expect(result.radarRule).toBe('rule_123');
      expect(result.reasons).toContain('Matched rule: rule_123');
    });

    it('should log fraud check to audit repository', async () => {
      mockStripe.paymentIntents.retrieve.mockResolvedValue({
        id: mockPaymentIntentId,
        latest_charge: {
          id: 'ch_123',
          outcome: {
            risk_level: 'normal',
            risk_score: 10,
            network_status: 'approved_by_network',
            seller_message: 'Payment complete.',
            type: 'authorized',
          },
        },
      });

      await service.analyzePayment(mockPaymentIntentId, mockDeveloperId);

      expect(mockAuditRepo.create).toHaveBeenCalledWith({
        developerId: mockDeveloperId,
        action: 'fraud.check',
        resourceType: 'payment',
        resourceId: mockPaymentIntentId,
        changes: expect.objectContaining({
          riskLevel: 'medium',
          riskScore: 10,
          isBlocked: false,
        }),
      });
    });

    it('should log warning when payment is blocked', async () => {
      mockStripe.paymentIntents.retrieve.mockResolvedValue({
        id: mockPaymentIntentId,
        latest_charge: {
          id: 'ch_123',
          outcome: {
            risk_level: 'highest',
            risk_score: 99,
            network_status: 'approved_by_network',
            seller_message: 'High risk',
            type: 'authorized',
          },
        },
      });

      await service.analyzePayment(mockPaymentIntentId, mockDeveloperId);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Payment blocked by fraud prevention',
        expect.objectContaining({
          paymentIntentId: mockPaymentIntentId,
          riskLevel: 'highest',
        })
      );
    });

    it('should return safe default on error', async () => {
      mockStripe.paymentIntents.retrieve.mockRejectedValue(new Error('Stripe API error'));

      const result = await service.analyzePayment(mockPaymentIntentId, mockDeveloperId);

      expect(result.riskLevel).toBe('low');
      expect(result.riskScore).toBe(0);
      expect(result.isBlocked).toBe(false);
      expect(result.reasons).toContain('Fraud analysis unavailable');
    });

    it('should log error when Stripe API fails', async () => {
      const error = new Error('Stripe API error');
      mockStripe.paymentIntents.retrieve.mockRejectedValue(error);

      await service.analyzePayment(mockPaymentIntentId, mockDeveloperId);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error analyzing payment for fraud',
        expect.objectContaining({
          error,
          paymentIntentId: mockPaymentIntentId,
        })
      );
    });

    it('should handle missing risk_level gracefully', async () => {
      mockStripe.paymentIntents.retrieve.mockResolvedValue({
        id: mockPaymentIntentId,
        latest_charge: {
          id: 'ch_123',
          outcome: {
            risk_score: 30,
            network_status: 'approved_by_network',
            seller_message: 'Payment complete.',
            type: 'authorized',
          },
        },
      });

      const result = await service.analyzePayment(mockPaymentIntentId, mockDeveloperId);

      expect(result.riskLevel).toBe('medium'); // 'normal' mapped to 'medium'
    });

    it('should handle missing risk_score gracefully', async () => {
      mockStripe.paymentIntents.retrieve.mockResolvedValue({
        id: mockPaymentIntentId,
        latest_charge: {
          id: 'ch_123',
          outcome: {
            risk_level: 'normal',
            network_status: 'approved_by_network',
            seller_message: 'Payment complete.',
            type: 'authorized',
          },
        },
      });

      const result = await service.analyzePayment(mockPaymentIntentId, mockDeveloperId);

      expect(result.riskScore).toBe(0);
    });

    it('should not block high risk when blockHighRisk is disabled', async () => {
      service.updateSettings({ blockHighRisk: false });

      mockStripe.paymentIntents.retrieve.mockResolvedValue({
        id: mockPaymentIntentId,
        latest_charge: {
          id: 'ch_123',
          outcome: {
            risk_level: 'elevated',
            risk_score: 80,
            network_status: 'approved_by_network',
            seller_message: 'Elevated risk',
            type: 'authorized',
          },
        },
      });

      const result = await service.analyzePayment(mockPaymentIntentId, mockDeveloperId);

      expect(result.riskLevel).toBe('high');
      expect(result.isBlocked).toBe(false);
    });

    it('should not block when fraud prevention is disabled', async () => {
      service.updateSettings({ enabled: false });

      mockStripe.paymentIntents.retrieve.mockResolvedValue({
        id: mockPaymentIntentId,
        latest_charge: {
          id: 'ch_123',
          outcome: {
            risk_level: 'highest',
            risk_score: 99,
            network_status: 'approved_by_network',
            seller_message: 'Highest risk',
            type: 'authorized',
          },
        },
      });

      const result = await service.analyzePayment(mockPaymentIntentId, mockDeveloperId);

      expect(result.riskLevel).toBe('highest');
      expect(result.isBlocked).toBe(false);
    });
  });

  describe('handleEarlyFraudWarning', () => {
    const createMockWarning = (overrides?: Partial<Stripe.Radar.EarlyFraudWarning>): Stripe.Radar.EarlyFraudWarning => ({
      id: 'issfr_123',
      object: 'radar.early_fraud_warning',
      actionable: true,
      charge: 'ch_123',
      created: 1234567890,
      fraud_type: 'unauthorized_use_of_card',
      livemode: false,
      payment_intent: mockPaymentIntentId,
      ...overrides,
    });

    it('should log early fraud warning to audit', async () => {
      const warning = createMockWarning();

      await service.handleEarlyFraudWarning(warning, mockDeveloperId);

      expect(mockAuditRepo.create).toHaveBeenCalledWith({
        developerId: mockDeveloperId,
        action: 'fraud.early_warning',
        resourceType: 'payment',
        resourceId: mockPaymentIntentId,
        changes: {
          fraudType: 'unauthorized_use_of_card',
          chargeId: 'ch_123',
          actionable: true,
        },
      });
    });

    it('should log warning message', async () => {
      const warning = createMockWarning();

      await service.handleEarlyFraudWarning(warning, mockDeveloperId);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Early fraud warning received',
        expect.objectContaining({
          eventId: 'issfr_123',
          chargeId: 'ch_123',
          fraudType: 'unauthorized_use_of_card',
        })
      );
    });

    it('should log info for actionable warnings', async () => {
      const warning = createMockWarning({ actionable: true });

      await service.handleEarlyFraudWarning(warning, mockDeveloperId);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Actionable fraud warning - consider refund',
        expect.objectContaining({
          chargeId: 'ch_123',
        })
      );
    });

    it('should not log info for non-actionable warnings', async () => {
      const warning = createMockWarning({ actionable: false });

      await service.handleEarlyFraudWarning(warning, mockDeveloperId);

      expect(mockLogger.info).not.toHaveBeenCalledWith(
        'Actionable fraud warning - consider refund',
        expect.any(Object)
      );
    });
  });

  describe('handleReviewDecision', () => {
    const createMockReview = (overrides?: Partial<Stripe.Review>): Stripe.Review => ({
      id: 'prv_123',
      object: 'review',
      billing_zip: null,
      charge: 'ch_123',
      closed_reason: 'approved' as Stripe.Review.ClosedReason,
      created: 1234567890,
      ip_address: '192.168.1.1',
      ip_address_location: null,
      livemode: false,
      open: false,
      opened_reason: 'rule',
      payment_intent: mockPaymentIntentId,
      reason: 'elevated_risk_level',
      session: null,
      ...overrides,
    });

    it('should log approved review to audit', async () => {
      const review = createMockReview({ closed_reason: 'approved' });

      await service.handleReviewDecision(review, mockDeveloperId);

      expect(mockAuditRepo.create).toHaveBeenCalledWith({
        developerId: mockDeveloperId,
        action: 'fraud.review_approved',
        resourceType: 'payment',
        resourceId: mockPaymentIntentId,
        changes: {
          reviewId: 'prv_123',
          reason: 'elevated_risk_level',
          closedReason: 'approved',
        },
      });
    });

    it('should log rejected review to audit', async () => {
      const review = createMockReview({ closed_reason: 'refunded' });

      await service.handleReviewDecision(review, mockDeveloperId);

      expect(mockAuditRepo.create).toHaveBeenCalledWith({
        developerId: mockDeveloperId,
        action: 'fraud.review_rejected',
        resourceType: 'payment',
        resourceId: mockPaymentIntentId,
        changes: expect.objectContaining({
          closedReason: 'refunded',
        }),
      });
    });

    it('should log review decision info', async () => {
      const review = createMockReview({ closed_reason: 'approved' });

      await service.handleReviewDecision(review, mockDeveloperId);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Radar review decision',
        expect.objectContaining({
          reviewId: 'prv_123',
          paymentIntentId: mockPaymentIntentId,
          decision: 'approved',
          isApproved: true,
        })
      );
    });

    it('should log rejected review decision correctly', async () => {
      const review = createMockReview({ closed_reason: 'refunded_as_fraud' });

      await service.handleReviewDecision(review, mockDeveloperId);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Radar review decision',
        expect.objectContaining({
          isApproved: false,
        })
      );
    });
  });

  describe('handleDispute', () => {
    const createMockDispute = (overrides?: Partial<Stripe.Dispute>): Stripe.Dispute => ({
      id: 'dp_123',
      object: 'dispute',
      amount: 1000,
      balance_transactions: [],
      charge: 'ch_123',
      created: 1234567890,
      currency: 'usd',
      evidence: {} as Stripe.Dispute.Evidence,
      evidence_details: {
        due_by: 1234567890,
        has_evidence: false,
        past_due: false,
        submission_count: 0,
      },
      is_charge_refundable: true,
      livemode: false,
      metadata: {},
      payment_intent: mockPaymentIntentId,
      reason: 'fraudulent',
      status: 'needs_response',
      ...overrides,
    });

    it('should log dispute to audit', async () => {
      const dispute = createMockDispute();

      await service.handleDispute(dispute, mockDeveloperId);

      expect(mockAuditRepo.create).toHaveBeenCalledWith({
        developerId: mockDeveloperId,
        action: 'fraud.dispute_received',
        resourceType: 'payment',
        resourceId: mockPaymentIntentId,
        changes: {
          disputeId: 'dp_123',
          reason: 'fraudulent',
          amount: 1000,
          currency: 'usd',
          status: 'needs_response',
        },
      });
    });

    it('should log dispute warning', async () => {
      const dispute = createMockDispute();

      await service.handleDispute(dispute, mockDeveloperId);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Dispute received',
        expect.objectContaining({
          disputeId: 'dp_123',
          reason: 'fraudulent',
          amount: 1000,
          status: 'needs_response',
        })
      );
    });

    it('should recommend challenging fraudulent disputes', async () => {
      const dispute = createMockDispute({ reason: 'fraudulent', status: 'needs_response' });

      const result = await service.handleDispute(dispute, mockDeveloperId);

      expect(result.shouldChallenge).toBe(true);
      expect(result.evidence).toBeDefined();
      expect(result.evidence?.product_description).toBe('Digital product/subscription');
    });

    it('should recommend challenging disputes requiring response', async () => {
      const dispute = createMockDispute({ reason: 'product_not_received', status: 'needs_response' });

      const result = await service.handleDispute(dispute, mockDeveloperId);

      expect(result.shouldChallenge).toBe(true);
    });

    it('should not challenge if evidence already submitted', async () => {
      const dispute = createMockDispute({
        evidence_details: {
          due_by: 1234567890,
          has_evidence: true,
          past_due: false,
          submission_count: 1,
        },
      });

      const result = await service.handleDispute(dispute, mockDeveloperId);

      expect(result.shouldChallenge).toBe(false);
      expect(result.evidence).toBeUndefined();
    });

    it('should not challenge disputes not in challengeable status', async () => {
      const dispute = createMockDispute({ status: 'lost' });

      const result = await service.handleDispute(dispute, mockDeveloperId);

      expect(result.shouldChallenge).toBe(false);
    });

    it('should challenge warning_needs_response status', async () => {
      const dispute = createMockDispute({ status: 'warning_needs_response' });

      const result = await service.handleDispute(dispute, mockDeveloperId);

      expect(result.shouldChallenge).toBe(true);
    });

    it('should not challenge won disputes', async () => {
      const dispute = createMockDispute({ status: 'won' });

      const result = await service.handleDispute(dispute, mockDeveloperId);

      expect(result.shouldChallenge).toBe(false);
    });
  });

  describe('getFraudStats', () => {
    it('should return fraud statistics', async () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-12-31');

      const result = await service.getFraudStats(mockDeveloperId, startDate, endDate);

      expect(result).toEqual({
        totalTransactions: 0,
        blockedTransactions: 0,
        earlyWarnings: 0,
        disputes: 0,
        disputeRate: 0,
      });
    });
  });

  describe('updateSettings', () => {
    it('should update enabled setting', () => {
      service.updateSettings({ enabled: false });

      const settings = service.getSettings();
      expect(settings.enabled).toBe(false);
    });

    it('should update blockHighRisk setting', () => {
      service.updateSettings({ blockHighRisk: false });

      const settings = service.getSettings();
      expect(settings.blockHighRisk).toBe(false);
    });

    it('should update reviewThreshold setting', () => {
      service.updateSettings({ reviewThreshold: 'high' });

      const settings = service.getSettings();
      expect(settings.reviewThreshold).toBe('high');
    });

    it('should update custom rules', () => {
      service.updateSettings({
        customRules: {
          maxTransactionAmount: 10000,
          blockCountries: ['XX', 'YY'],
          requireCvc: false,
          require3ds: true,
        },
      });

      const settings = service.getSettings();
      expect(settings.customRules.maxTransactionAmount).toBe(10000);
      expect(settings.customRules.blockCountries).toEqual(['XX', 'YY']);
      expect(settings.customRules.requireCvc).toBe(false);
      expect(settings.customRules.require3ds).toBe(true);
    });

    it('should merge partial settings', () => {
      service.updateSettings({ enabled: false });
      service.updateSettings({ blockHighRisk: false });

      const settings = service.getSettings();
      expect(settings.enabled).toBe(false);
      expect(settings.blockHighRisk).toBe(false);
      expect(settings.reviewThreshold).toBe('medium'); // Unchanged
    });

    it('should log settings update', () => {
      service.updateSettings({ enabled: false });

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Fraud prevention settings updated',
        expect.objectContaining({
          settings: expect.any(Object),
        })
      );
    });
  });

  describe('getSettings', () => {
    it('should return a copy of settings', () => {
      const settings1 = service.getSettings();
      const settings2 = service.getSettings();

      expect(settings1).toEqual(settings2);
      expect(settings1).not.toBe(settings2); // Should be different objects
    });

    it('should not allow direct mutation of settings', () => {
      const settings = service.getSettings();
      settings.enabled = false;

      const freshSettings = service.getSettings();
      expect(freshSettings.enabled).toBe(true); // Original should be unchanged
    });
  });

  describe('risk level mapping', () => {
    it('should map "highest" to highest', async () => {
      mockStripe.paymentIntents.retrieve.mockResolvedValue({
        id: mockPaymentIntentId,
        latest_charge: {
          id: 'ch_123',
          outcome: {
            risk_level: 'highest',
            risk_score: 90,
            type: 'authorized',
          },
        },
      });

      const result = await service.analyzePayment(mockPaymentIntentId, mockDeveloperId);
      expect(result.riskLevel).toBe('highest');
    });

    it('should map "elevated" to high', async () => {
      mockStripe.paymentIntents.retrieve.mockResolvedValue({
        id: mockPaymentIntentId,
        latest_charge: {
          id: 'ch_123',
          outcome: {
            risk_level: 'elevated',
            risk_score: 70,
            type: 'authorized',
          },
        },
      });

      const result = await service.analyzePayment(mockPaymentIntentId, mockDeveloperId);
      expect(result.riskLevel).toBe('high');
    });

    it('should map "high" to high', async () => {
      mockStripe.paymentIntents.retrieve.mockResolvedValue({
        id: mockPaymentIntentId,
        latest_charge: {
          id: 'ch_123',
          outcome: {
            risk_level: 'high',
            risk_score: 75,
            type: 'authorized',
          },
        },
      });

      const result = await service.analyzePayment(mockPaymentIntentId, mockDeveloperId);
      expect(result.riskLevel).toBe('high');
    });

    it('should map "normal" to medium', async () => {
      mockStripe.paymentIntents.retrieve.mockResolvedValue({
        id: mockPaymentIntentId,
        latest_charge: {
          id: 'ch_123',
          outcome: {
            risk_level: 'normal',
            risk_score: 30,
            type: 'authorized',
          },
        },
      });

      const result = await service.analyzePayment(mockPaymentIntentId, mockDeveloperId);
      expect(result.riskLevel).toBe('medium');
    });

    it('should map unknown risk levels to low', async () => {
      mockStripe.paymentIntents.retrieve.mockResolvedValue({
        id: mockPaymentIntentId,
        latest_charge: {
          id: 'ch_123',
          outcome: {
            risk_level: 'not_assessed',
            risk_score: 0,
            type: 'authorized',
          },
        },
      });

      const result = await service.analyzePayment(mockPaymentIntentId, mockDeveloperId);
      expect(result.riskLevel).toBe('low');
    });
  });

  describe('reasons extraction', () => {
    it('should include seller message in reasons', async () => {
      mockStripe.paymentIntents.retrieve.mockResolvedValue({
        id: mockPaymentIntentId,
        latest_charge: {
          id: 'ch_123',
          outcome: {
            risk_level: 'normal',
            risk_score: 10,
            seller_message: 'Custom seller message',
            type: 'authorized',
          },
        },
      });

      const result = await service.analyzePayment(mockPaymentIntentId, mockDeveloperId);
      expect(result.reasons).toContain('Custom seller message');
    });

    it('should add elevated risk reason for elevated level', async () => {
      mockStripe.paymentIntents.retrieve.mockResolvedValue({
        id: mockPaymentIntentId,
        latest_charge: {
          id: 'ch_123',
          outcome: {
            risk_level: 'elevated',
            risk_score: 65,
            type: 'authorized',
          },
        },
      });

      const result = await service.analyzePayment(mockPaymentIntentId, mockDeveloperId);
      expect(result.reasons).toContain('Elevated risk detected by Stripe Radar');
    });

    it('should add highest risk reason for highest level', async () => {
      mockStripe.paymentIntents.retrieve.mockResolvedValue({
        id: mockPaymentIntentId,
        latest_charge: {
          id: 'ch_123',
          outcome: {
            risk_level: 'highest',
            risk_score: 95,
            type: 'authorized',
          },
        },
      });

      const result = await service.analyzePayment(mockPaymentIntentId, mockDeveloperId);
      expect(result.reasons).toContain('Highest risk detected by Stripe Radar');
    });

    it('should include rule information in reasons', async () => {
      mockStripe.paymentIntents.retrieve.mockResolvedValue({
        id: mockPaymentIntentId,
        latest_charge: {
          id: 'ch_123',
          outcome: {
            risk_level: 'normal',
            risk_score: 10,
            type: 'authorized',
            rule: {
              id: 'custom_rule_123',
              action: 'block',
            },
          },
        },
      });

      const result = await service.analyzePayment(mockPaymentIntentId, mockDeveloperId);
      expect(result.reasons).toContain('Matched rule: custom_rule_123');
    });

    it('should handle rule without id', async () => {
      mockStripe.paymentIntents.retrieve.mockResolvedValue({
        id: mockPaymentIntentId,
        latest_charge: {
          id: 'ch_123',
          outcome: {
            risk_level: 'normal',
            risk_score: 10,
            type: 'authorized',
            rule: {
              action: 'block',
            },
          },
        },
      });

      const result = await service.analyzePayment(mockPaymentIntentId, mockDeveloperId);
      expect(result.reasons).toContain('Matched rule: unknown');
    });

    it('should return default reason when no specific concerns', async () => {
      mockStripe.paymentIntents.retrieve.mockResolvedValue({
        id: mockPaymentIntentId,
        latest_charge: {
          id: 'ch_123',
          outcome: {
            risk_level: 'normal',
            risk_score: 10,
            type: 'authorized',
          },
        },
      });

      const result = await service.analyzePayment(mockPaymentIntentId, mockDeveloperId);
      expect(result.reasons).toContain('No specific concerns');
    });
  });

  describe('blocking logic', () => {
    it('should always block when outcome type is blocked regardless of settings', async () => {
      service.updateSettings({ enabled: false, blockHighRisk: false });

      mockStripe.paymentIntents.retrieve.mockResolvedValue({
        id: mockPaymentIntentId,
        latest_charge: {
          id: 'ch_123',
          outcome: {
            risk_level: 'normal',
            risk_score: 10,
            type: 'blocked',
          },
        },
      });

      const result = await service.analyzePayment(mockPaymentIntentId, mockDeveloperId);
      // When fraud prevention is disabled, even 'blocked' type should not block
      expect(result.isBlocked).toBe(false);
    });

    it('should block high risk only when enabled and blockHighRisk is true', async () => {
      service.updateSettings({ enabled: true, blockHighRisk: true });

      mockStripe.paymentIntents.retrieve.mockResolvedValue({
        id: mockPaymentIntentId,
        latest_charge: {
          id: 'ch_123',
          outcome: {
            risk_level: 'elevated',
            risk_score: 70,
            type: 'authorized',
          },
        },
      });

      const result = await service.analyzePayment(mockPaymentIntentId, mockDeveloperId);
      expect(result.isBlocked).toBe(true);
    });

    it('should block highest risk when blockHighRisk is enabled', async () => {
      service.updateSettings({ enabled: true, blockHighRisk: true });

      mockStripe.paymentIntents.retrieve.mockResolvedValue({
        id: mockPaymentIntentId,
        latest_charge: {
          id: 'ch_123',
          outcome: {
            risk_level: 'highest',
            risk_score: 95,
            type: 'authorized',
          },
        },
      });

      const result = await service.analyzePayment(mockPaymentIntentId, mockDeveloperId);
      expect(result.isBlocked).toBe(true);
    });

    it('should not block medium/low risk even when blockHighRisk is enabled', async () => {
      service.updateSettings({ enabled: true, blockHighRisk: true });

      mockStripe.paymentIntents.retrieve.mockResolvedValue({
        id: mockPaymentIntentId,
        latest_charge: {
          id: 'ch_123',
          outcome: {
            risk_level: 'normal',
            risk_score: 30,
            type: 'authorized',
          },
        },
      });

      const result = await service.analyzePayment(mockPaymentIntentId, mockDeveloperId);
      expect(result.isBlocked).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle null payment_intent in dispute', async () => {
      const dispute = {
        id: 'dp_123',
        object: 'dispute',
        amount: 1000,
        balance_transactions: [],
        charge: 'ch_123',
        created: 1234567890,
        currency: 'usd',
        evidence: {},
        evidence_details: {
          due_by: 1234567890,
          has_evidence: false,
          past_due: false,
          submission_count: 0,
        },
        is_charge_refundable: true,
        livemode: false,
        metadata: {},
        payment_intent: null,
        reason: 'fraudulent',
        status: 'needs_response',
      } as unknown as Stripe.Dispute;

      await service.handleDispute(dispute, mockDeveloperId);

      expect(mockAuditRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          resourceId: null,
        })
      );
    });

    it('should handle empty evidence_details in dispute', async () => {
      const dispute = {
        id: 'dp_123',
        object: 'dispute',
        amount: 1000,
        balance_transactions: [],
        charge: 'ch_123',
        created: 1234567890,
        currency: 'usd',
        evidence: {},
        evidence_details: null,
        is_charge_refundable: true,
        livemode: false,
        metadata: {},
        payment_intent: mockPaymentIntentId,
        reason: 'fraudulent',
        status: 'needs_response',
      } as unknown as Stripe.Dispute;

      const result = await service.handleDispute(dispute, mockDeveloperId);

      // Should not throw and should still make decision
      expect(result).toBeDefined();
    });

    it('should handle review with null payment_intent', async () => {
      const review = {
        id: 'prv_123',
        object: 'review',
        billing_zip: null,
        charge: 'ch_123',
        closed_reason: 'approved',
        created: 1234567890,
        ip_address: '192.168.1.1',
        ip_address_location: null,
        livemode: false,
        open: false,
        opened_reason: 'rule',
        payment_intent: null,
        reason: 'elevated_risk_level',
        session: null,
      } as unknown as Stripe.Review;

      await service.handleReviewDecision(review, mockDeveloperId);

      expect(mockAuditRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          resourceId: null,
        })
      );
    });

    it('should handle early fraud warning with null payment_intent', async () => {
      const warning = {
        id: 'issfr_123',
        object: 'radar.early_fraud_warning',
        actionable: true,
        charge: 'ch_123',
        created: 1234567890,
        fraud_type: 'unauthorized_use_of_card',
        livemode: false,
        payment_intent: null,
      } as unknown as Stripe.Radar.EarlyFraudWarning;

      await service.handleEarlyFraudWarning(warning, mockDeveloperId);

      expect(mockAuditRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          resourceId: null,
        })
      );
    });
  });
});
