/**
 * 管理者管理画面の包括的単体テスト
 * 目的: 管理者によるユーザー管理、抽選結果確認、統計情報取得機能の品質を保証する
 * I/O: Express の Request/Response をモックして検証する
 * 注意点: 管理者権限の確認、各種統計情報の正確性をテストする
 */

import { Request, Response } from 'express';
import userController from '../../../src/controllers/user.controller';
import campaignController from '../../../src/controllers/campaign.controller';
import lotteryController from '../../../src/controllers/lottery.controller';
import userService from '../../../src/services/user.service';
import campaignService from '../../../src/services/campaign.service';
import lotteryService from '../../../src/services/lottery.service';
import { AuthorizedRequest } from '../../../src/middleware/role.middleware';
import { UserRole } from '../../../src/models/user.entity';

// 依存モジュールのモック設定
jest.mock('../../../src/services/user.service');
jest.mock('../../../src/services/campaign.service');
jest.mock('../../../src/services/lottery.service');

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

describe('管理者管理画面包括的テスト', () => {
  let mockRequest: Partial<AuthorizedRequest>;
  let mockResponse: Partial<Response>;
  let responseObject: Record<string, unknown>;

  const mockAdminUser = {
    user_id: 'admin-uid-123',
    email: 'admin@example.com',
    display_name: 'Test Admin',
    role: UserRole.ADMIN,
  };

  beforeEach(() => {
    mockRequest = {
      dbUser: mockAdminUser,
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

  describe('ユーザー一覧取得', () => {
    it('管理者がユーザー一覧を取得できる', async () => {
      const mockUsers = [
        {
          user_id: 'user-1',
          email: 'user1@example.com',
          display_name: 'User One',
          avatar_url: null,
          fcm_token: null,
          role: UserRole.CUSTOMER,
          notification_enabled: true,
          total_purchases: 5,
          total_spent: 5000,
          prizes_won: 1,
          last_login_at: new Date(),
          created_at: new Date(),
          updated_at: new Date(),
        },
        {
          user_id: 'user-2',
          email: 'user2@example.com',
          display_name: 'User Two',
          avatar_url: null,
          fcm_token: null,
          role: UserRole.CUSTOMER,
          notification_enabled: true,
          total_purchases: 3,
          total_spent: 3000,
          prizes_won: 0,
          last_login_at: new Date(),
          created_at: new Date(),
          updated_at: new Date(),
        },
      ];

      mockRequest.query = { limit: '50', offset: '0' };

      (userService.listUsers as jest.Mock).mockResolvedValue(mockUsers);
      (userService.getUserCount as jest.Mock).mockResolvedValue(2);

      await runHandler(
        userController.listUsers,
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(responseObject).toMatchObject({
        success: true,
        data: mockUsers,
        pagination: {
          limit: 50,
          offset: 0,
          total: 2,
        },
      });
      expect(userService.listUsers).toHaveBeenCalledWith(50, 0);
    });

    it('ページネーションが正しく動作する', async () => {
      const mockUsers = [
        {
          user_id: 'user-3',
          email: 'user3@example.com',
          display_name: 'User Three',
          avatar_url: null,
          fcm_token: null,
          role: UserRole.CUSTOMER,
          notification_enabled: true,
          total_purchases: 2,
          total_spent: 2000,
          prizes_won: 0,
          last_login_at: new Date(),
          created_at: new Date(),
          updated_at: new Date(),
        },
      ];

      mockRequest.query = { limit: '10', offset: '20' };

      (userService.listUsers as jest.Mock).mockResolvedValue(mockUsers);
      (userService.getUserCount as jest.Mock).mockResolvedValue(25);

      await runHandler(
        userController.listUsers,
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(userService.listUsers).toHaveBeenCalledWith(10, 20);
      expect(responseObject).toMatchObject({
        pagination: {
          limit: 10,
          offset: 20,
          total: 25,
        },
      });
    });
  });

  describe('ユーザーロール更新', () => {
    it('管理者がユーザーのロールを更新できる', async () => {
      const updatedUser = {
        user_id: 'user-1',
        email: 'user1@example.com',
        display_name: 'User One',
        avatar_url: null,
        fcm_token: null,
        role: UserRole.ADMIN,
        notification_enabled: true,
        total_purchases: 5,
        total_spent: 5000,
        prizes_won: 1,
        last_login_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      };

      mockRequest.params = { id: 'user-1' };
      mockRequest.body = { role: UserRole.ADMIN };

      (userService.updateUser as jest.Mock).mockResolvedValue(updatedUser);
      (userService.getUserById as jest.Mock).mockResolvedValue(updatedUser);

      await runHandler(
        userController.updateUserRole,
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(responseObject).toMatchObject({
        success: true,
        message: 'User role updated successfully',
        data: updatedUser,
      });
      expect(userService.updateUser).toHaveBeenCalledWith('user-1', { role: UserRole.ADMIN });
    });

    it('無効なロールを指定すると400エラーを返す', async () => {
      mockRequest.params = { id: 'user-1' };
      mockRequest.body = { role: 'invalid-role' };

      await runHandler(
        userController.updateUserRole,
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(responseObject).toMatchObject({
        success: false,
        message: 'Invalid role. Must be "customer" or "admin"',
      });
    });
  });

  describe('キャンペーン統計情報取得', () => {
    it('管理者がキャンペーンの統計情報を取得できる', async () => {
      const mockStats = {
        positions_total: 100,
        positions_sold: 50,
        positions_available: 50,
        progress_percent: 50.0,
        unique_buyers: 25,
        total_revenue: 50000,
      };

      mockRequest.params = { campaignId: 'campaign-123' };

      (campaignService.getCampaignStats as jest.Mock).mockResolvedValue(mockStats);

      await runHandler(
        campaignController.getCampaignStats,
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(responseObject).toMatchObject({
        success: true,
        data: mockStats,
      });
      expect(campaignService.getCampaignStats).toHaveBeenCalledWith('campaign-123');
    });
  });

  describe('抽選結果一覧取得', () => {
    it('管理者がキャンペーンの抽選結果一覧を取得できる', async () => {
      const mockWinners = [
        {
          user_id: 'user-1',
          user_email: 'user1@example.com',
          user_display_name: 'User One',
          position_row: 1,
          position_col: 1,
          position_layer: 1,
          prize_id: 'prize-1',
          prize_name: 'First Prize',
          prize_rank: 1,
          prize_image_url: null,
          drawn_at: new Date(),
        },
        {
          user_id: 'user-2',
          user_email: 'user2@example.com',
          user_display_name: 'User Two',
          position_row: 2,
          position_col: 2,
          position_layer: 1,
          prize_id: 'prize-2',
          prize_name: 'Second Prize',
          prize_rank: 2,
          prize_image_url: null,
          drawn_at: new Date(),
        },
      ];

      mockRequest.params = { campaignId: 'campaign-123' };

      (lotteryService.getCampaignResults as jest.Mock).mockResolvedValue(mockWinners);

      await runHandler(
        lotteryController.getCampaignResults,
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(responseObject).toMatchObject({
        success: true,
        data: mockWinners,
      });
    });
  });

  describe('管理者存在確認', () => {
    it('管理者が存在する場合、trueを返す', async () => {
      (userService.hasAdminUser as jest.Mock).mockResolvedValue(true);

      await runHandler(
        userController.checkAdminExists,
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(responseObject).toMatchObject({
        success: true,
        data: {
          hasAdmin: true,
        },
      });
    });

    it('管理者が存在しない場合、falseを返す', async () => {
      (userService.hasAdminUser as jest.Mock).mockResolvedValue(false);

      await runHandler(
        userController.checkAdminExists,
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(responseObject).toMatchObject({
        success: true,
        data: {
          hasAdmin: false,
        },
      });
    });
  });
});
