import { LotteryService } from '../../../src/services/lottery.service';
import { pool } from '../../../src/config/database.config';
import { generateUUID } from '../../../src/utils/crypto.util';
import campaignService from '../../../src/services/campaign.service';
import { CampaignStatus } from '../../../src/models/campaign.entity';

// Mock dependencies
jest.mock('../../../src/config/database.config');
jest.mock('../../../src/utils/crypto.util');
jest.mock('../../../src/services/campaign.service');
jest.mock('../../../src/services/notification.service');
jest.mock('../../../src/utils/logger.util', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

describe('LotteryService', () => {
  let service: LotteryService;
  let mockClient: {
    query: jest.Mock;
    release: jest.Mock;
  };

  const mockCampaign = {
    campaign_id: 'campaign-123',
    name: 'Test Campaign',
    status: CampaignStatus.CLOSED,
    positions_total: 10,
    positions_sold: 10, // 售罄状态
    end_date: new Date(Date.now() - 1000), // 已结束
    prizes: [
      { prize_id: 'prize-1', rank: 1, quantity: 1, name: 'Prize 1' },
      { prize_id: 'prize-2', rank: 2, quantity: 1, name: 'Prize 2' },
    ],
  };

  const mockSoldPositions = [
    { position_id: 'pos-1', user_id: 'user-1' },
    { position_id: 'pos-2', user_id: 'user-2' },
  ];

  beforeEach(() => {
    service = new LotteryService();
    mockClient = {
      query: jest.fn(),
      release: jest.fn(),
    };
    (pool.connect as jest.Mock).mockResolvedValue(mockClient);
    (pool.query as jest.Mock) = jest.fn();
    (generateUUID as jest.MockedFunction<typeof generateUUID>).mockReturnValue('lottery-result-uuid-123');
    (campaignService.getCampaignDetail as jest.Mock).mockResolvedValue(mockCampaign);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('drawLottery', () => {

    it('should draw lottery successfully', async () => {
      // Setup a flexible mock for all query calls
      mockClient.query.mockImplementation(async (query: string) => {
        if (query.includes('pg_try_advisory_xact_lock')) return { rows: [{ locked: true }] };
        if (query.includes('SELECT COUNT(*) as count FROM lottery_results')) return { rows: [{ count: 0 }] };
        if (query.includes('ORDER BY RANDOM()')) return { rows: mockSoldPositions };
        if (query.includes('SELECT user_id, email')) return { rows: [{ user_id: 'user-1', email: 'u1@test.com', display_name: 'User One' }] };
        return { rows: [] }; // Default for BEGIN, COMMIT, SET, INSERTs, UPDATEs
      });
      
      const result = await service.drawLottery('campaign-123');

      expect(result).toBeDefined();
      expect(result.winners_count).toBe(2);
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith(expect.stringContaining('pg_try_advisory_xact_lock'), expect.any(Array));
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should throw error if campaign not found', async () => {
      (campaignService.getCampaignDetail as jest.Mock).mockResolvedValue(null);
       mockClient.query.mockImplementation(async (query: string) => {
        if (query.includes('pg_try_advisory_xact_lock')) return { rows: [{ locked: true }] };
        return { rows: [] };
      });

      await expect(service.drawLottery('non-existent')).rejects.toThrow('CAMPAIGN_NOT_FOUND');

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    });

    it('should throw error if campaign not closed', async () => {
      (campaignService.getCampaignDetail as jest.Mock).mockResolvedValue({ 
        ...mockCampaign, 
        status: CampaignStatus.PUBLISHED,
        positions_sold: 5, // 未售罄
        end_date: new Date(Date.now() + 1000), // 未结束
      });
       mockClient.query.mockImplementation(async (query: string) => {
        if (query.includes('pg_try_advisory_xact_lock')) return { rows: [{ locked: true }] };
        return { rows: [] };
      });

      await expect(service.drawLottery('campaign-123')).rejects.toThrow(
        'Campaign must be ended or sold out before drawing lottery'
      );

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    });

    it('should throw error if advisory lock cannot be acquired', async () => {
        mockClient.query.mockImplementation(async (query: string) => {
            if (query.includes('pg_try_advisory_xact_lock')) return { rows: [{ locked: false }] };
            return { rows: [] };
        });

      await expect(service.drawLottery('campaign-123')).rejects.toThrow(
        'Lottery draw already in progress for this campaign'
      );

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    });
  });

  describe('getCampaignResults', () => {
    it('should return list of winners', async () => {
      const mockWinners = [
        { user_id: 'user-1', prize_rank: 1 },
        { user_id: 'user-2', prize_rank: 2 },
      ];
      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: mockWinners });

      const result = await service.getCampaignResults('campaign-123');

      expect(result).toBeDefined();
      expect(result).toHaveLength(2);
      expect(result[0].user_id).toBe('user-1');
    });

    it('should return empty array if no results found', async () => {
      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });
      const result = await service.getCampaignResults('non-existent');
      expect(result).toEqual([]);
    });
  });
});

