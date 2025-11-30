import { PaymentService } from '../../../src/services/payment.service';
import { pool } from '../../../src/config/database.config';
import { stripe } from '../../../src/config/stripe.config';
import purchaseService from '../../../src/services/purchase.service';
import notificationService from '../../../src/services/notification.service';
import { CreatePaymentIntentDto, PaymentMethod } from '../../../src/models/payment.entity';
import { PurchaseStatus } from '../../../src/models/purchase.entity';
import { generateUUID } from '../../../src/utils/crypto.util';
import Stripe from 'stripe';

// Mock dependencies
jest.mock('../../../src/config/database.config');
jest.mock('../../../src/config/stripe.config');
jest.mock('../../../src/services/purchase.service');
jest.mock('../../../src/services/notification.service');
jest.mock('../../../src/utils/crypto.util');
jest.mock('../../../src/utils/logger.util', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

describe('PaymentService', () => {
  let service: PaymentService;
  let mockClient: {
    query: jest.Mock;
    release: jest.Mock;
  };

  beforeEach(() => {
    service = new PaymentService();
    mockClient = {
      query: jest.fn(),
      release: jest.fn(),
    };
    (pool.connect as jest.Mock) = jest.fn().mockResolvedValue(mockClient);
    (pool.query as jest.Mock) = jest.fn();
    (generateUUID as jest.MockedFunction<typeof generateUUID>).mockReturnValue('transaction-uuid-123');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createPaymentIntent', () => {
    const validDto: CreatePaymentIntentDto = {
      purchase_id: 'purchase-123',
      payment_method: PaymentMethod.CARD,
      return_url: 'https://example.com/return',
    };

    it('should create card payment intent successfully', async () => {
      const mockPurchase = {
        purchase_id: 'purchase-123',
        user_id: 'user-123',
        campaign_id: 'campaign-123',
        position_id: 'position-1',
        quantity: 1,
        price_per_position: 1000,
        total_amount: 1000,
        status: PurchaseStatus.PENDING,
        created_at: new Date(),
        updated_at: new Date(),
      };

      const mockPaymentIntent = {
        id: 'pi_123',
        amount: 1000,
        currency: 'jpy',
        status: 'requires_payment_method',
        metadata: {
          purchase_id: 'purchase-123',
          user_id: 'user-123',
          campaign_id: 'campaign-123',
        },
      } as unknown as Stripe.PaymentIntent;

      const mockTransaction = {
        transaction_id: 'transaction-uuid-123',
        purchase_id: 'purchase-123',
        user_id: 'user-123',
        amount: 1000,
        currency: 'jpy',
        payment_method: PaymentMethod.CARD,
        payment_status: 'pending',
        stripe_payment_intent_id: 'pi_123',
        created_at: new Date(),
        updated_at: new Date(),
      };

      (purchaseService.getPurchaseById as jest.Mock).mockResolvedValueOnce(mockPurchase);
      (stripe.paymentIntents.create as jest.Mock).mockResolvedValueOnce(mockPaymentIntent);

      mockClient.query
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [mockTransaction] }) // INSERT transaction
        .mockResolvedValueOnce({ rows: [] }); // COMMIT

      const result = await service.createPaymentIntent(validDto, 'user-123');

      expect(result).toBeDefined();
      expect(result.paymentIntent.id).toBe('pi_123');
      expect(result.transaction.transaction_id).toBe('transaction-uuid-123');
      expect(stripe.paymentIntents.create).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 1000,
          currency: 'jpy',
          payment_method_types: ['card'],
          return_url: 'https://example.com/return',
        })
      );
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    });

    it('should create konbini payment intent with expiration', async () => {
      const konbiniDto: CreatePaymentIntentDto = {
        purchase_id: 'purchase-123',
        payment_method: PaymentMethod.KONBINI,
      };

      const mockPurchase = {
        purchase_id: 'purchase-123',
        user_id: 'user-123',
        campaign_id: 'campaign-123',
        position_id: 'position-1',
        quantity: 1,
        price_per_position: 1000,
        total_amount: 1000,
        status: PurchaseStatus.PENDING,
        created_at: new Date(),
        updated_at: new Date(),
      };

      const mockPaymentIntent = {
        id: 'pi_konbini_123',
        amount: 1000,
        currency: 'jpy',
        status: 'requires_payment_method',
        metadata: {},
      } as unknown as Stripe.PaymentIntent;

      const mockTransaction = {
        transaction_id: 'transaction-uuid-123',
        purchase_id: 'purchase-123',
        user_id: 'user-123',
        amount: 1000,
        currency: 'jpy',
        payment_method: PaymentMethod.KONBINI,
        payment_status: 'pending',
        stripe_payment_intent_id: 'pi_konbini_123',
        created_at: new Date(),
        updated_at: new Date(),
      };

      (purchaseService.getPurchaseById as jest.Mock).mockResolvedValueOnce(mockPurchase);
      (stripe.paymentIntents.create as jest.Mock).mockResolvedValueOnce(mockPaymentIntent);

      mockClient.query
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [mockTransaction] }) // INSERT
        .mockResolvedValueOnce({ rows: [] }); // COMMIT

      await service.createPaymentIntent(konbiniDto, 'user-123');

      expect(stripe.paymentIntents.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payment_method_types: ['konbini'],
          payment_method_options: {
            konbini: {
              expires_after_days: 4,
            },
          },
        })
      );
    });

    it('should throw error if purchase not found', async () => {
      (purchaseService.getPurchaseById as jest.Mock).mockResolvedValueOnce(null);

      mockClient.query.mockResolvedValueOnce({ rows: [] }); // BEGIN

      await expect(service.createPaymentIntent(validDto, 'user-123')).rejects.toThrow(
        'PURCHASE_NOT_FOUND'
      );

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should throw error if user does not own purchase', async () => {
      const mockPurchase = {
        purchase_id: 'purchase-123',
        user_id: 'other-user',
        campaign_id: 'campaign-123',
        position_id: 'position-1',
        quantity: 1,
        price_per_position: 1000,
        total_amount: 1000,
        status: PurchaseStatus.PENDING,
        created_at: new Date(),
        updated_at: new Date(),
      };

      (purchaseService.getPurchaseById as jest.Mock).mockResolvedValueOnce(mockPurchase);

      mockClient.query.mockResolvedValueOnce({ rows: [] }); // BEGIN

      await expect(service.createPaymentIntent(validDto, 'user-123')).rejects.toThrow('FORBIDDEN');

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    });

    it('should throw error if purchase already paid', async () => {
      const mockPurchase = {
        purchase_id: 'purchase-123',
        user_id: 'user-123',
        campaign_id: 'campaign-123',
        position_id: 'position-1',
        quantity: 1,
        price_per_position: 1000,
        total_amount: 1000,
        status: PurchaseStatus.COMPLETED,
        created_at: new Date(),
        updated_at: new Date(),
      };

      (purchaseService.getPurchaseById as jest.Mock).mockResolvedValueOnce(mockPurchase);

      mockClient.query.mockResolvedValueOnce({ rows: [] }); // BEGIN

      await expect(service.createPaymentIntent(validDto, 'user-123')).rejects.toThrow(
        'Purchase already paid'
      );

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    });
  });

  describe('handleWebhook', () => {
    it('should handle payment_intent.succeeded event', async () => {
      const mockEvent = {
        id: 'evt_123',
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_123',
            latest_charge: 'ch_123',
            metadata: {
              purchase_id: 'purchase-123',
            },
          } as unknown as Stripe.PaymentIntent,
        },
      } as Stripe.Event;

      const mockTransaction = {
        transaction_id: 'transaction-123',
        purchase_id: 'purchase-123',
        stripe_payment_intent_id: 'pi_123',
        payment_status: 'pending',
      };

      mockClient.query.mockResolvedValue({ rows: [mockTransaction] });
      (purchaseService.updatePurchaseStatus as jest.Mock).mockResolvedValue({});

      await service.handleWebhook(mockEvent);

      const mockPurchase = {
        purchase_id: 'purchase-123',
        user_id: 'user-123',
        campaign_id: 'campaign-123',
        position_id: 'position-1',
      };

      (purchaseService.getPurchaseById as jest.Mock).mockResolvedValueOnce(mockPurchase);
      (notificationService.sendToUser as jest.Mock).mockResolvedValueOnce(undefined);

      expect(purchaseService.updatePurchaseStatus).toHaveBeenCalledWith(
        'purchase-123',
        PurchaseStatus.COMPLETED
      );
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE payment_transactions"),
        expect.arrayContaining(['ch_123', 'transaction-123'])
      );
      // Verify notification was sent
      expect(notificationService.sendToUser).toHaveBeenCalledWith(
        'user-123',
        expect.any(String),
        expect.objectContaining({
          title: '決済が完了しました',
        })
      );
    });

    it('should handle payment_intent.payment_failed event', async () => {
      const mockEvent = {
        id: 'evt_456',
        type: 'payment_intent.payment_failed',
        data: {
          object: {
            id: 'pi_456',
            metadata: {
              purchase_id: 'purchase-456',
            },
            last_payment_error: { message: 'Card declined' }
          } as unknown as Stripe.PaymentIntent,
        },
      } as Stripe.Event;

      const mockTransaction = {
        transaction_id: 'transaction-456',
        purchase_id: 'purchase-456',
        stripe_payment_intent_id: 'pi_456',
        payment_status: 'pending',
      };

      mockClient.query.mockResolvedValue({ rows: [mockTransaction] });
      (purchaseService.updatePurchaseStatus as jest.Mock).mockResolvedValue({});

      await service.handleWebhook(mockEvent);

      const mockPurchase = {
        purchase_id: 'purchase-456',
        user_id: 'user-456',
        campaign_id: 'campaign-456',
      };

      (purchaseService.getPurchaseById as jest.Mock).mockResolvedValueOnce(mockPurchase);
      (notificationService.sendToUser as jest.Mock).mockResolvedValueOnce(undefined);

      expect(purchaseService.updatePurchaseStatus).toHaveBeenCalledWith(
        'purchase-456',
        PurchaseStatus.FAILED
      );
       expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE payment_transactions"),
        expect.arrayContaining(['Card declined', 'transaction-456'])
      );
      // Verify notification was sent
      expect(notificationService.sendToUser).toHaveBeenCalledWith(
        'user-456',
        expect.any(String),
        expect.objectContaining({
          title: '決済に失敗しました',
        })
      );
    });

    it('should handle unhandled event types gracefully', async () => {
      const mockEvent = {
        id: 'evt_789',
        type: 'customer.created',
        data: {
          object: {} as unknown as Stripe.Customer,
        },
      } as Stripe.Event;

      await expect(service.handleWebhook(mockEvent)).resolves.not.toThrow();
    });
  });

  describe('confirmPayment', () => {
    it('should confirm payment with payment method', async () => {
      const mockPaymentIntent = {
        id: 'pi_123',
        status: 'succeeded',
      } as unknown as Stripe.PaymentIntent;

      (stripe.paymentIntents.confirm as jest.Mock).mockResolvedValueOnce(mockPaymentIntent);

      const result = await service.confirmPayment('pi_123', 'pm_card_123');

      expect(result.status).toBe('succeeded');
      expect(stripe.paymentIntents.confirm).toHaveBeenCalledWith('pi_123', {
        payment_method: 'pm_card_123',
      });
    });
  });
});

