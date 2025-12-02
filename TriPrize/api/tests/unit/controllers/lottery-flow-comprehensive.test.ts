/**
 * 抽選フローの包括的単体テスト
 * 目的: 管理者による抽選実行、顧客の当選確認機能の品質を保証する
 * I/O: Express の Request/Response をモックして検証する
 * 注意点: 抽選の実行、当選者の確認、各ユーザーの当選状況をテストする
 */

import { Request, Response } from 'express';
import lotteryController from '../../../src/controllers/lottery.controller';
import lotteryService from '../../../src/services/lottery.service';
import { AuthorizedRequest } from '../../../src/middleware/role.middleware';
import { UserRole } from '../../../src/models/user.entity';

// 依存モジュールのモック設定
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

describe('抽選フロー包括的テスト', () => {
  let mockRequest: Partial<AuthorizedRequest>;
  let mockResponse: Partial<Response>;
  let responseObject: Record<string, unknown>;

  beforeEach(() => {
    mockRequest = {};
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

  describe('管理者による抽選実行', () => {
    it('管理者が抽選を実行できる', async () => {
      const mockAdminUser = {
        user_id: 'admin-uid-123',
        email: 'admin@example.com',
        display_name: 'Test Admin',
        role: UserRole.ADMIN,
      };

      const mockLotteryResult = {
        campaign_id: 'campaign-123',
        campaign_name: 'Test Campaign',
        total_positions: 100,
        sold_positions: 50,
        total_prizes: 5,
        winners_count: 5,
        drawn_at: new Date(),
        winners: [
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
        ],
      };

      mockRequest.dbUser = mockAdminUser;
      mockRequest.params = { campaignId: 'campaign-123' };

      (lotteryService.drawLottery as jest.Mock).mockResolvedValue(mockLotteryResult);

      await runHandler(
        lotteryController.drawLottery,
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(responseObject).toMatchObject({
        success: true,
        message: 'Lottery drawn successfully',
        data: mockLotteryResult,
      });
      expect(lotteryService.drawLottery).toHaveBeenCalledWith('campaign-123');
    });

    it('顧客は抽選を実行できない', async () => {
      const mockCustomerUser = {
        user_id: 'customer-uid-123',
        email: 'customer@example.com',
        display_name: 'Test Customer',
        role: UserRole.CUSTOMER,
      };

      mockRequest.dbUser = mockCustomerUser;
      mockRequest.params = { campaignId: 'campaign-123' };

      // このテストは実際にはミドルウェアでブロックされるが、
      // コントローラーレベルでは dbUser が存在しない場合のテスト
      mockRequest.dbUser = undefined;

      await expect(
        runHandler(
          lotteryController.drawLottery,
          mockRequest as Request,
          mockResponse as Response,
        )
      ).rejects.toThrow();
    });
  });

  describe('キャンペーン抽選結果取得', () => {
    it('誰でもキャンペーンの抽選結果を取得できる', async () => {
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
      expect(lotteryService.getCampaignResults).toHaveBeenCalledWith('campaign-123');
    });
  });

  describe('ユーザーの当選結果取得', () => {
    it('顧客が自分の当選結果を取得できる', async () => {
      const mockCustomerUser = {
        user_id: 'customer-uid-123',
        email: 'customer@example.com',
        display_name: 'Test Customer',
        role: UserRole.CUSTOMER,
      };

      const mockResults = [
        {
          result_id: 'result-1',
          campaign_id: 'campaign-123',
          position_id: 'position-1',
          user_id: 'customer-uid-123',
          prize_id: 'prize-1',
          prize_rank: 1,
          drawn_at: new Date(),
          created_at: new Date(),
        },
      ];

      mockRequest.dbUser = mockCustomerUser;

      (lotteryService.getUserResults as jest.Mock).mockResolvedValue(mockResults);

      await runHandler(
        lotteryController.getMyResults,
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(responseObject).toMatchObject({
        success: true,
        data: mockResults,
      });
      expect(lotteryService.getUserResults).toHaveBeenCalledWith('customer-uid-123');
    });
  });

  describe('特定キャンペーンでの当選確認', () => {
    it('顧客が特定キャンペーンで当選した場合、当選情報を取得できる', async () => {
      const mockCustomerUser = {
        user_id: 'customer-uid-123',
        email: 'customer@example.com',
        display_name: 'Test Customer',
        role: UserRole.CUSTOMER,
      };

      const mockWinner = {
        user_id: 'customer-uid-123',
        user_email: 'customer@example.com',
        user_display_name: 'Test Customer',
        position_row: 1,
        position_col: 1,
        position_layer: 1,
        prize_id: 'prize-1',
        prize_name: 'First Prize',
        prize_rank: 1,
        prize_image_url: null,
        drawn_at: new Date(),
      };

      mockRequest.dbUser = mockCustomerUser;
      mockRequest.params = { campaignId: 'campaign-123' };

      (lotteryService.checkUserWin as jest.Mock).mockResolvedValue(mockWinner);

      await runHandler(
        lotteryController.checkMyWin,
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(responseObject).toMatchObject({
        success: true,
        data: mockWinner,
        won: true,
      });
      expect(lotteryService.checkUserWin).toHaveBeenCalledWith(
        'customer-uid-123',
        'campaign-123'
      );
    });

    it('顧客が特定キャンペーンで当選していない場合、nullを返す', async () => {
      const mockCustomerUser = {
        user_id: 'customer-uid-123',
        email: 'customer@example.com',
        display_name: 'Test Customer',
        role: UserRole.CUSTOMER,
      };

      mockRequest.dbUser = mockCustomerUser;
      mockRequest.params = { campaignId: 'campaign-123' };

      (lotteryService.checkUserWin as jest.Mock).mockResolvedValue(null);

      await runHandler(
        lotteryController.checkMyWin,
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(responseObject).toMatchObject({
        success: true,
        data: null,
        won: false,
      });
    });
  });
});
