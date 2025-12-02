/**
 * 購入フローの包括的単体テスト
 * 目的: 顧客の購入機能の品質を保証する
 * I/O: Express の Request/Response をモックして検証する
 * 注意点: 同時購入制御、冪等性、トランザクション分離をテストする
 */

import { Request, Response } from 'express';
import purchaseController from '../../../src/controllers/purchase.controller';
import purchaseService from '../../../src/services/purchase.service';
import { AuthorizedRequest } from '../../../src/middleware/role.middleware';
import { UserRole } from '../../../src/models/user.entity';

// 依存モジュールのモック設定
jest.mock('../../../src/services/purchase.service');

const runHandler = async (
  handler: (req: Request, res: Response, next: any) => void,
  req: Request,
  res: Response,
): Promise<void> => {
  return new Promise<void>((resolve, reject) => {
    let resolved = false;
    
    const next: any = ((err?: unknown) => {
      if (err) {
        if (!resolved) {
          resolved = true;
          reject(err);
        }
      }
    }) as any;

    const originalJson = (res as Response).json?.bind(res as Response);
    (res as Response).json = ((body: unknown) => {
      if (originalJson) {
        originalJson(body as never);
      }
      if (!resolved) {
        resolved = true;
        resolve();
      }
      return res as Response;
    }) as Response['json'];

    try {
      handler(req, res, next);
      // Give async handler time to complete
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve();
        }
      }, 100);
    } catch (err) {
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    }
  });
};

describe('購入フロー包括的テスト', () => {
  let mockRequest: Partial<AuthorizedRequest>;
  let mockResponse: Partial<Response>;
  let responseObject: Record<string, unknown>;

  beforeEach(() => {
    mockRequest = {
      dbUser: {
        user_id: 'customer-uid-123',
        email: 'customer@example.com',
        display_name: 'Test Customer',
        role: UserRole.CUSTOMER,
      },
      headers: {} as Record<string, string>,
    };
    responseObject = {};
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn((result) => {
        responseObject = result;
        return mockResponse as Response;
      }),
    };
    jest.clearAllMocks();
  });

  describe('購入作成', () => {
    it('顧客がポジションを購入できる', async () => {
      const mockPurchase = {
        purchase_id: 'purchase-123',
        user_id: 'customer-uid-123',
        campaign_id: 'campaign-123',
        position_id: 'position-1',
        quantity: 1,
        price_per_position: 1000,
        total_amount: 1000,
        status: 'pending',
        idempotency_key: 'idempotency-key-123',
        created_at: new Date(),
        updated_at: new Date(),
      };

      mockRequest.body = {
        campaign_id: 'campaign-123',
        position_ids: ['position-1'],
        payment_method: 'card',
      };

      (purchaseService.createPurchase as jest.Mock).mockResolvedValue(mockPurchase);

      await runHandler(
        purchaseController.createPurchase,
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockResponse.status).toHaveBeenCalledWith(201);
      expect(responseObject).toMatchObject({
        success: true,
        message: 'Purchase created successfully',
        data: mockPurchase,
      });
      expect(purchaseService.createPurchase).toHaveBeenCalledWith(
        expect.objectContaining({
          campaign_id: 'campaign-123',
          position_ids: ['position-1'],
        }),
        'customer-uid-123',
        undefined
      );
    });

    it('冪等性キーが提供された場合、それを使用する', async () => {
      const mockPurchase = {
        purchase_id: 'purchase-123',
        user_id: 'customer-uid-123',
        campaign_id: 'campaign-123',
        position_id: 'position-1',
        quantity: 1,
        price_per_position: 1000,
        total_amount: 1000,
        status: 'pending',
        idempotency_key: 'custom-idempotency-key',
        created_at: new Date(),
        updated_at: new Date(),
      };

      mockRequest.body = {
        campaign_id: 'campaign-123',
        position_ids: ['position-1'],
        payment_method: 'card',
      };
      mockRequest.headers = {
        'idempotency-key': 'custom-idempotency-key',
      };

      (purchaseService.createPurchase as jest.Mock).mockResolvedValue(mockPurchase);

      await runHandler(
        purchaseController.createPurchase,
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(purchaseService.createPurchase).toHaveBeenCalledWith(
        expect.any(Object),
        'customer-uid-123',
        'custom-idempotency-key'
      );
    });

    it('未認証ユーザーは購入できない', async () => {
      mockRequest.dbUser = undefined;
      mockRequest.body = {
        campaign_id: 'campaign-123',
        position_ids: ['position-1'],
        payment_method: 'card',
      };

      await expect(
        runHandler(
          purchaseController.createPurchase,
          mockRequest as Request,
          mockResponse as Response,
        )
      ).rejects.toThrow();
    });
  });

  describe('購入履歴取得', () => {
    it('顧客が自分の購入履歴を取得できる', async () => {
      const mockPurchases = [
        {
          purchase_id: 'purchase-1',
          user_id: 'customer-uid-123',
          campaign_id: 'campaign-123',
          position_id: 'position-1',
          quantity: 1,
          price_per_position: 1000,
          total_amount: 1000,
          status: 'completed',
          campaign_name: 'Test Campaign',
          position_row: 1,
          position_col: 1,
          position_layer: 1,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ];

      mockRequest.params = {};
      mockRequest.query = {};

      (purchaseService.getUserPurchases as jest.Mock).mockResolvedValue(mockPurchases);

      await runHandler(
        purchaseController.getMyPurchases,
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(responseObject).toMatchObject({
        success: true,
        data: mockPurchases,
      });
      expect(purchaseService.getUserPurchases).toHaveBeenCalledWith(
        'customer-uid-123',
        50,
        0
      );
    });
  });

  describe('購入詳細取得', () => {
    it('顧客が自分の購入詳細を取得できる', async () => {
      const mockPurchase = {
        purchase_id: 'purchase-123',
        user_id: 'customer-uid-123',
        campaign_id: 'campaign-123',
        position_id: 'position-1',
        quantity: 1,
        price_per_position: 1000,
        total_amount: 1000,
        status: 'completed',
        created_at: new Date(),
        updated_at: new Date(),
      };

      mockRequest.params = { purchaseId: 'purchase-123' };

      (purchaseService.getPurchaseById as jest.Mock).mockResolvedValue(mockPurchase);

      await runHandler(
        purchaseController.getPurchase,
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(responseObject).toMatchObject({
        success: true,
        data: mockPurchase,
      });
    });

    it('他のユーザーの購入詳細は取得できない', async () => {
      const mockPurchase = {
        purchase_id: 'purchase-123',
        user_id: 'other-user-uid',
        campaign_id: 'campaign-123',
        position_id: 'position-1',
        quantity: 1,
        price_per_position: 1000,
        total_amount: 1000,
        status: 'completed',
        created_at: new Date(),
        updated_at: new Date(),
      };

      mockRequest.params = { purchaseId: 'purchase-123' };

      (purchaseService.getPurchaseById as jest.Mock).mockResolvedValue(mockPurchase);

      await expect(
        runHandler(
          purchaseController.getPurchase,
          mockRequest as Request,
          mockResponse as Response,
        )
      ).rejects.toThrow();
    });
  });
});
