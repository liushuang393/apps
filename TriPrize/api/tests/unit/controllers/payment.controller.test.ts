import { Request, Response } from 'express';
import paymentController from '../../../src/controllers/payment.controller';
import paymentService from '../../../src/services/payment.service';
import { AuthorizedRequest } from '../../../src/middleware/role.middleware';
import { UserRole } from '../../../src/models/user.entity';
import { stripe } from '../../../src/config/stripe.config';

/**
 * PaymentController の単体テスト
 * 目的: 支払いインテント作成/確認、取引参照、Webhook 処理の挙動と権限チェックを検証する
 * I/O: AuthorizedRequest/Request をモックし、Stripe/DB アクセスは service/mocked stripe で代替する
 * 注意点: controller は asyncHandler でラップされているため、レスポンス json 呼び出しをフックして完了を検知する
 */

jest.mock('../../../src/services/payment.service');
jest.mock('../../../src/config/stripe.config', () => ({
  stripe: {
    webhooks: {
      constructEvent: jest.fn(),
    },
  },
  PAYMENT_CONFIG: {
    useMockPayment: false,
    isProduction: false,
    isTestMode: true,
    isLiveMode: false,
  },
}));

const runAuthHandler = async (
  handler: (req: AuthorizedRequest, res: Response, next: (err?: unknown) => void) => void,
  req: AuthorizedRequest,
  res: Response,
): Promise<void> => {
  return new Promise<void>((resolve, reject) => {
    let resolved = false;
    
    const originalJson = res.json.bind(res);
    res.json = ((body: unknown) => {
      originalJson(body as never);
      if (!resolved) {
        resolved = true;
        resolve();
      }
      return res;
    }) as Response['json'];

    const next = (err?: unknown): void => {
      if (err) {
        if (!resolved) {
          resolved = true;
          reject(err);
        }
      }
    };

    try {
      handler(req, res, next);
      // Give async handler time to complete
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve();
        }
      }, 100);
    } catch (error) {
      if (!resolved) {
        resolved = true;
        reject(error);
      }
    }
  });
};

const runRequestHandler = async (
  handler: (req: Request, res: Response, next: (err?: unknown) => void) => void,
  req: Request,
  res: Response,
): Promise<void> => {
  return new Promise<void>((resolve, reject) => {
    let resolved = false;
    
    const originalJson = res.json.bind(res);
    res.json = ((body: unknown) => {
      originalJson(body as never);
      if (!resolved) {
        resolved = true;
        resolve();
      }
      return res;
    }) as Response['json'];

    const next = (err?: unknown): void => {
      if (err) {
        if (!resolved) {
          resolved = true;
          reject(err);
        }
      }
    };

    try {
      handler(req, res, next);
      // Give async handler time to complete
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve();
        }
      }, 100);
    } catch (error) {
      if (!resolved) {
        resolved = true;
        reject(error);
      }
    }
  });
};

describe('PaymentController', () => {
  let mockAuthRequest: Partial<AuthorizedRequest>;
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let responseBody: unknown;

  beforeEach(() => {
    mockAuthRequest = {};
    mockRequest = {};
    responseBody = undefined;
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn((body: unknown) => {
        responseBody = body;
        return mockResponse as Response;
      }),
    };
    jest.clearAllMocks();
  });

  describe('createPaymentIntent', () => {
    it('should create payment intent for authenticated user', async () => {
      const dbUser = {
        user_id: 'user-1',
        email: 'user@example.com',
        role: UserRole.CUSTOMER,
        display_name: 'User',
      };
      const dto = { amount: 1000, currency: 'jpy' } as Record<string, unknown>;
      const paymentIntent = { id: 'pi_1', client_secret: 'secret', status: 'requires_payment_method' };
      const transaction = { transaction_id: 'tx_1', amount: 1000, currency: 'jpy' };

      mockAuthRequest.dbUser = dbUser;
      mockAuthRequest.body = dto;

      (paymentService.createPaymentIntent as jest.Mock).mockResolvedValue({ paymentIntent, transaction });

      await runAuthHandler(
        paymentController.createPaymentIntent,
        mockAuthRequest as AuthorizedRequest,
        mockResponse as Response,
      );

      expect(paymentService.createPaymentIntent).toHaveBeenCalledWith(dto, 'user-1');
      expect(mockResponse.status).toHaveBeenCalledWith(201);
      expect(responseBody).toEqual({
        success: true,
        data: {
          client_secret: 'secret',
          payment_intent_id: 'pi_1',
          transaction_id: 'tx_1',
          amount: 1000,
          currency: 'jpy',
          status: 'requires_payment_method',
        },
      });
    });

    it('should throw unauthorized when dbUser missing', async () => {
      mockAuthRequest.dbUser = undefined;
      mockAuthRequest.body = {};

      await expect(
        runAuthHandler(
          paymentController.createPaymentIntent,
          mockAuthRequest as AuthorizedRequest,
          mockResponse as Response,
        ),
      ).rejects.toHaveProperty('statusCode', 401);
    });
  });

  describe('confirmPayment', () => {
    it('should confirm payment and return intent data', async () => {
      const dbUser = {
        user_id: 'user-1',
        email: 'user@example.com',
        role: UserRole.CUSTOMER,
        display_name: 'User',
      };
      const paymentIntent = { id: 'pi_1', client_secret: 'secret', status: 'succeeded' };

      mockAuthRequest.dbUser = dbUser;
      mockAuthRequest.body = {
        payment_intent_id: 'pi_1',
        payment_method_id: 'pm_1',
      } as Record<string, unknown>;

      (paymentService.confirmPayment as jest.Mock).mockResolvedValue(paymentIntent);

      await runAuthHandler(
        paymentController.confirmPayment,
        mockAuthRequest as AuthorizedRequest,
        mockResponse as Response,
      );

      expect(paymentService.confirmPayment).toHaveBeenCalledWith('pi_1', 'pm_1');
      expect(responseBody).toEqual({
        success: true,
        data: {
          payment_intent_id: 'pi_1',
          status: 'succeeded',
          client_secret: 'secret',
        },
      });
    });
  });

  describe('getKonbiniDetails', () => {
    it('should return konbini payment info when exists', async () => {
      const dbUser = {
        user_id: 'user-1',
        email: 'user@example.com',
        role: UserRole.CUSTOMER,
        display_name: 'User',
      };
      const konbiniInfo = { store: 'Lawson', number: '1234' };

      mockAuthRequest.dbUser = dbUser;
      mockAuthRequest.params = { paymentIntentId: 'pi_1' } as Record<string, string>;

      (paymentService.getKonbiniPaymentInfo as jest.Mock).mockResolvedValue(konbiniInfo);

      await runAuthHandler(
        paymentController.getKonbiniDetails,
        mockAuthRequest as AuthorizedRequest,
        mockResponse as Response,
      );

      expect(paymentService.getKonbiniPaymentInfo).toHaveBeenCalledWith('pi_1');
      expect(responseBody).toEqual({
        success: true,
        data: konbiniInfo,
      });
    });
  });

  describe('getTransaction / getMyTransactions', () => {
    it('should return transaction for owner', async () => {
      const dbUser = {
        user_id: 'user-1',
        email: 'user@example.com',
        role: UserRole.CUSTOMER,
        display_name: 'User',
      };
      const transaction = { transaction_id: 'tx_1', user_id: 'user-1' };

      mockAuthRequest.dbUser = dbUser;
      mockAuthRequest.params = { transactionId: 'tx_1' } as Record<string, string>;

      (paymentService.getTransactionById as jest.Mock).mockResolvedValue(transaction);

      await runAuthHandler(
        paymentController.getTransaction,
        mockAuthRequest as AuthorizedRequest,
        mockResponse as Response,
      );

      expect(paymentService.getTransactionById).toHaveBeenCalledWith('tx_1');
      expect(responseBody).toEqual({
        success: true,
        data: transaction,
      });
    });

    it('should return paginated transactions for current user', async () => {
      const dbUser = {
        user_id: 'user-1',
        email: 'user@example.com',
        role: UserRole.CUSTOMER,
        display_name: 'User',
      };
      const transactions = [{ transaction_id: 'tx_1', user_id: 'user-1' }];

      mockAuthRequest.dbUser = dbUser;
      mockAuthRequest.query = { limit: '20', offset: '0' } as unknown as AuthorizedRequest['query'];

      (paymentService.getUserTransactions as jest.Mock).mockResolvedValue(transactions);

      await runAuthHandler(
        paymentController.getMyTransactions,
        mockAuthRequest as AuthorizedRequest,
        mockResponse as Response,
      );

      expect(paymentService.getUserTransactions).toHaveBeenCalledWith('user-1', 20, 0);
      expect(responseBody).toEqual({
        success: true,
        data: transactions,
        pagination: { limit: 20, offset: 0, total: transactions.length },
      });
    });
  });

  describe('handleWebhook', () => {
    it('should call paymentService.handleWebhook when signature valid', async () => {
      const stripeConstructEventSpy = jest
        .spyOn(stripe!.webhooks, 'constructEvent')
        .mockReturnValue({ id: 'evt_1' } as never);

      mockRequest.headers = { 'stripe-signature': 'sig_123' } as Record<string, string>;
      mockRequest.body = '{}' as unknown as string;

      (paymentService.handleWebhook as jest.Mock).mockResolvedValue(undefined);

      await runRequestHandler(
        paymentController.handleWebhook,
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(stripeConstructEventSpy).toHaveBeenCalled();
      expect(paymentService.handleWebhook).toHaveBeenCalled();
      expect(responseBody).toEqual({ received: true });
    });
  });
});
