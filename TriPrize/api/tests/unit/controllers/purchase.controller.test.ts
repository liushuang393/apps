import { Response } from 'express';
import purchaseController from '../../../src/controllers/purchase.controller';
import purchaseService from '../../../src/services/purchase.service';
import { AuthorizedRequest } from '../../../src/middleware/role.middleware';
import { UserRole } from '../../../src/models/user.entity';

/**
 * PurchaseController の単体テスト
 * 目的: 購入作成/取得/一覧/キャンセルの挙動を検証し、権限チェックを保証する
 * I/O: AuthorizedRequest をモックし、DB アクセスは service のモックで代替する
 * 注意点: controller は asyncHandler でラップされているため、テスト側で完了タイミングを制御する
 */

jest.mock('../../../src/services/purchase.service');

const runHandler = async (
	handler: (req: AuthorizedRequest, res: Response, next: (err?: unknown) => void) => void,
	req: AuthorizedRequest,
	res: Response,
): Promise<void> => {
	return new Promise<void>((resolve, reject) => {
		const originalJson = res.json.bind(res);
		res.json = ((body: unknown) => {
			originalJson(body as never);
			resolve();
			return res;
		}) as Response['json'];

		const next = (err?: unknown): void => {
			if (err) {
				reject(err);
			}
		};

		try {
			handler(req, res, next);
		} catch (error) {
			reject(error);
		}
	});
};

describe('PurchaseController', () => {
  let mockRequest: Partial<AuthorizedRequest>;
  let mockResponse: Partial<Response>;
  let responseBody: unknown;

  beforeEach(() => {
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

  describe('createPurchase', () => {
    it('should create purchase with idempotency key', async () => {
      const dbUser = {
        user_id: 'user-1',
        email: 'user@example.com',
        role: UserRole.CUSTOMER,
        display_name: 'User',
      };
      const dto = { campaign_id: 'camp-1', positions: [1, 2, 3] } as unknown as Record<string, unknown>;
      const purchase = { purchase_id: 'p-1', user_id: 'user-1' };

      mockRequest.dbUser = dbUser;
      mockRequest.body = dto;
      mockRequest.headers = { 'idempotency-key': 'idem-key-1' } as Record<string, string>;

      (purchaseService.createPurchase as jest.Mock).mockResolvedValue(purchase);

      await runHandler(
        purchaseController.createPurchase,
        mockRequest as AuthorizedRequest,
        mockResponse as Response,
      );

      expect(purchaseService.createPurchase).toHaveBeenCalledWith(dto, 'user-1', 'idem-key-1');
      expect(mockResponse.status).toHaveBeenCalledWith(201);
      expect(responseBody).toEqual({
        success: true,
        data: purchase,
        message: 'Purchase created successfully',
      });
    });

    it('should throw unauthorized when dbUser is missing', async () => {
      mockRequest.dbUser = undefined;
      mockRequest.body = {};

      await expect(
        runHandler(
          purchaseController.createPurchase,
          mockRequest as AuthorizedRequest,
          mockResponse as Response,
        ),
      ).rejects.toHaveProperty('statusCode', 401);
    });
  });

  describe('getPurchase', () => {
    it('should return purchase for owner', async () => {
      const dbUser = {
        user_id: 'user-1',
        email: 'user@example.com',
        role: UserRole.CUSTOMER,
        display_name: 'User',
      };
      const purchase = { purchase_id: 'p-1', user_id: 'user-1' };

      mockRequest.dbUser = dbUser;
      mockRequest.params = { purchaseId: 'p-1' } as Record<string, string>;

      (purchaseService.getPurchaseById as jest.Mock).mockResolvedValue(purchase);

      await runHandler(
        purchaseController.getPurchase,
        mockRequest as AuthorizedRequest,
        mockResponse as Response,
      );

      expect(purchaseService.getPurchaseById).toHaveBeenCalledWith('p-1');
      expect(responseBody).toEqual({
        success: true,
        data: purchase,
      });
    });

    it('should throw notFound when purchase missing', async () => {
      const dbUser = {
        user_id: 'user-1',
        email: 'user@example.com',
        role: UserRole.CUSTOMER,
        display_name: 'User',
      };

      mockRequest.dbUser = dbUser;
      mockRequest.params = { purchaseId: 'p-404' } as Record<string, string>;

      (purchaseService.getPurchaseById as jest.Mock).mockResolvedValue(null);

      await expect(
        runHandler(
          purchaseController.getPurchase,
          mockRequest as AuthorizedRequest,
          mockResponse as Response,
        ),
      ).rejects.toHaveProperty('statusCode', 404);
    });

    it('should forbid access for non-owner non-admin', async () => {
      const dbUser = {
        user_id: 'user-2',
        email: 'user2@example.com',
        role: UserRole.CUSTOMER,
        display_name: 'User2',
      };
      const purchase = { purchase_id: 'p-1', user_id: 'user-1' };

      mockRequest.dbUser = dbUser;
      mockRequest.params = { purchaseId: 'p-1' } as Record<string, string>;

      (purchaseService.getPurchaseById as jest.Mock).mockResolvedValue(purchase);

      await expect(
        runHandler(
          purchaseController.getPurchase,
          mockRequest as AuthorizedRequest,
          mockResponse as Response,
        ),
      ).rejects.toHaveProperty('statusCode', 403);
    });
  });

  describe('getMyPurchases', () => {
    it('should return paginated purchases for current user', async () => {
      const dbUser = {
        user_id: 'user-1',
        email: 'user@example.com',
        role: UserRole.CUSTOMER,
        display_name: 'User',
      };
      const purchases = [{ purchase_id: 'p-1', user_id: 'user-1' }];

      mockRequest.dbUser = dbUser;
      mockRequest.query = { limit: '10', offset: '5' } as unknown as AuthorizedRequest['query'];

      (purchaseService.getUserPurchases as jest.Mock).mockResolvedValue(purchases);

      await runHandler(
        purchaseController.getMyPurchases,
        mockRequest as AuthorizedRequest,
        mockResponse as Response,
      );

      expect(purchaseService.getUserPurchases).toHaveBeenCalledWith('user-1', 10, 5);
      expect(responseBody).toEqual({
        success: true,
        data: purchases,
        pagination: { limit: 10, offset: 5, total: purchases.length },
      });
    });
  });

  describe('cancelPurchase', () => {
    it('should cancel purchase for current user', async () => {
      const dbUser = {
        user_id: 'user-1',
        email: 'user@example.com',
        role: UserRole.CUSTOMER,
        display_name: 'User',
      };

      mockRequest.dbUser = dbUser;
      mockRequest.params = { purchaseId: 'p-1' } as Record<string, string>;

      (purchaseService.cancelPurchase as jest.Mock).mockResolvedValue(undefined);

      await runHandler(
        purchaseController.cancelPurchase,
        mockRequest as AuthorizedRequest,
        mockResponse as Response,
      );

      expect(purchaseService.cancelPurchase).toHaveBeenCalledWith('p-1', 'user-1');
      expect(responseBody).toEqual({
        success: true,
        message: 'Purchase cancelled successfully',
      });
    });
  });
});
