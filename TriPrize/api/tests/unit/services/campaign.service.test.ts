import { CampaignService } from '../../../src/services/campaign.service';
import { pool } from '../../../src/config/database.config';
import { CampaignStatus, CreateCampaignDto } from '../../../src/models/campaign.entity';
import { generateUUID } from '../../../src/utils/crypto.util';

// Mock dependencies
jest.mock('../../../src/config/database.config');
jest.mock('../../../src/utils/crypto.util');
jest.mock('../../../src/utils/logger.util', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

describe('CampaignService', () => {
  let service: CampaignService;
  let mockClient: {
    query: jest.Mock;
    release: jest.Mock;
  };

  beforeEach(() => {
    service = new CampaignService();
    mockClient = {
      query: jest.fn(),
      release: jest.fn(),
    };
    (pool.connect as jest.Mock) = jest.fn().mockResolvedValue(mockClient);
    (pool.query as jest.Mock) = jest.fn();
    (generateUUID as jest.MockedFunction<typeof generateUUID>).mockReturnValue('test-uuid-123');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createCampaign', () => {
    const validDto: CreateCampaignDto = {
      name: 'Test Campaign',
      description: 'Test Description',
      base_length: 3,
      layer_prices: { '1': 100, '2': 200, '3': 300 },
      profit_margin_percent: 10,
      purchase_limit: 5,
      prizes: [
	        {
	          name: 'First Prize',
	          description: 'Grand Prize',
	          rank: 1,
	          quantity: 1,
	          value: 10000, // 景品の想定金額（テスト用の妥当な値）
	        },
	        {
	          name: 'Second Prize',
	          description: 'Runner Up',
	          rank: 2,
	          quantity: 2,
	          value: 5000,
	        },
      ],
    };

    it('should create a campaign successfully', async () => {
      const mockCampaignRow = {
        campaign_id: 'test-uuid-123',
        name: 'Test Campaign',
        description: 'Test Description',
        base_length: 3,
        positions_total: 6,
        positions_sold: 0,
        layer_prices: { '1': 100, '2': 200, '3': 300 },
        profit_margin_percent: 10,
        purchase_limit: 5,
        status: 'draft',
        start_date: null,
        end_date: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      // A more robust mock implementation
      mockClient.query.mockImplementation(async (query: string, values: any[]) => {
        if (query.startsWith('INSERT INTO campaigns')) {
          return { rows: [mockCampaignRow] };
        }
        if (query.startsWith('INSERT INTO layers')) {
          const layerNumber = values[1];
          return { rows: [{ layer_id: `layer-${layerNumber}` }] };
        }
        if (query.startsWith('INSERT INTO prizes')) {
          const rank = values[3];
          return { rows: [{ prize_id: `prize-${rank}` }] };
        }
        // Default for BEGIN, COMMIT, INSERT positions
        return { rows: [] };
      });

      const result = await service.createCampaign(validDto, 'creator-123');

      expect(result).toBeDefined();
      expect(result.campaign_id).toBe('test-uuid-123');
      expect(result.name).toBe('Test Campaign');
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should rollback on error', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockRejectedValueOnce(new Error('Database error')); // INSERT fails

      await expect(service.createCampaign(validDto, 'creator-123')).rejects.toThrow('Database error');

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should reject invalid layer prices', async () => {
      const invalidDto = {
        ...validDto,
        layer_prices: { '1': 100 }, // Missing layers 2 and 3
      };

      mockClient.query.mockResolvedValueOnce({ rows: [] }); // BEGIN

      await expect(service.createCampaign(invalidDto, 'creator-123')).rejects.toThrow(
        'Invalid layer prices configuration'
      );

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    });
  });

  describe('getCampaignById', () => {
    it('should return campaign when found', async () => {
      const mockRow = {
        campaign_id: 'campaign-123',
        name: 'Test Campaign',
        base_length: 3,
        positions_total: 6,
        positions_sold: 0,
        layer_prices: { '1': 100, '2': 200, '3': 300 },
        profit_margin_percent: 10,
        status: 'published',
        created_at: new Date(),
        updated_at: new Date(),
      };

      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [mockRow] });

      const result = await service.getCampaignById('campaign-123');

      expect(result).toBeDefined();
      expect(result?.campaign_id).toBe('campaign-123');
      expect(pool.query).toHaveBeenCalledWith(
        'SELECT * FROM campaigns WHERE campaign_id = $1',
        ['campaign-123']
      );
    });

    it('should return null when campaign not found', async () => {
      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

      const result = await service.getCampaignById('non-existent');

      expect(result).toBeNull();
    });

    it('should throw error on database failure', async () => {
      (pool.query as jest.Mock).mockRejectedValueOnce(new Error('DB connection failed'));

      await expect(service.getCampaignById('campaign-123')).rejects.toThrow('DB connection failed');
    });
  });

  describe('listCampaigns', () => {
    it('should list all campaigns without filter', async () => {
      const mockRows = [
        {
          campaign_id: 'campaign-1',
          name: 'Campaign 1',
          description: 'Desc 1',
          base_length: 3,
          positions_total: 6,
          positions_sold: 2,
          progress_percent: '33.33',
          min_price: 100,
          max_price: 300,
          status: 'published',
          end_date: null,
          created_at: new Date(),
        },
      ];

      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: mockRows });

      const result = await service.listCampaigns();

      expect(result).toHaveLength(1);
      expect(result[0].campaign_id).toBe('campaign-1');
      expect(result[0].progress_percent).toBe(33.33);
    });

    it('should filter campaigns by status', async () => {
      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

      await service.listCampaigns(CampaignStatus.PUBLISHED, 10, 0);

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE status = $1'),
        [CampaignStatus.PUBLISHED, 10, 0]
      );
    });

    it('should support pagination', async () => {
      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

      await service.listCampaigns(undefined, 20, 40);

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT'),
        [20, 40]
      );
    });
  });

  describe('updateCampaign', () => {
    it('should update campaign name', async () => {
      const existingCampaign = {
        campaign_id: 'campaign-123',
        name: 'Old Name',
        status: CampaignStatus.DRAFT,
        base_length: 3,
        positions_total: 6,
        positions_sold: 0,
        layer_prices: { '1': 100, '2': 200, '3': 300 },
        profit_margin_percent: 10,
        created_at: new Date(),
        updated_at: new Date(),
      };

      const updatedCampaign = { ...existingCampaign, name: 'New Name', updated_at: new Date() };

      // First call to getCampaignById inside updateCampaign
      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [existingCampaign] });

      mockClient.query
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [updatedCampaign] }) // UPDATE
        .mockResolvedValueOnce({ rows: [] }); // COMMIT

      const result = await service.updateCampaign('campaign-123', { name: 'New Name' });

      expect(result.name).toBe('New Name');
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    });

    it('should not allow updating layer prices after published', async () => {
      const publishedCampaign = {
        campaign_id: 'campaign-123',
        status: CampaignStatus.PUBLISHED,
        base_length: 3,
        positions_total: 6,
        positions_sold: 0,
        layer_prices: { '1': 100, '2': 200, '3': 300 },
        profit_margin_percent: 10,
        created_at: new Date(),
        updated_at: new Date(),
      };

      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [publishedCampaign] });
      mockClient.query
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [publishedCampaign] }); // SELECT existing

      await expect(
        service.updateCampaign('campaign-123', { layer_prices: { '1': 150, '2': 250, '3': 350 } })
      ).rejects.toThrow('Cannot update layer prices after campaign is published');

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    });
  });

  describe('deleteCampaign', () => {
    it('should delete draft campaign', async () => {
      const draftCampaign = {
        campaign_id: 'campaign-123',
        status: CampaignStatus.DRAFT,
        base_length: 3,
        positions_total: 6,
        positions_sold: 0,
        layer_prices: { '1': 100, '2': 200, '3': 300 },
        profit_margin_percent: 10,
        created_at: new Date(),
        updated_at: new Date(),
      };

      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [draftCampaign] });
      mockClient.query
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [draftCampaign] }) // SELECT
        .mockResolvedValueOnce({ rows: [] }) // DELETE
        .mockResolvedValueOnce({ rows: [] }); // COMMIT

      await service.deleteCampaign('campaign-123');

      expect(mockClient.query).toHaveBeenCalledWith(
        'DELETE FROM campaigns WHERE campaign_id = $1',
        ['campaign-123']
      );
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    });

    it('should not delete published campaign', async () => {
      const publishedCampaign = {
        campaign_id: 'campaign-123',
        status: CampaignStatus.PUBLISHED,
        base_length: 3,
        positions_total: 6,
        positions_sold: 0,
        layer_prices: { '1': 100, '2': 200, '3': 300 },
        profit_margin_percent: 10,
        created_at: new Date(),
        updated_at: new Date(),
      };

      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [publishedCampaign] });
      mockClient.query
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [publishedCampaign] }); // SELECT

      await expect(service.deleteCampaign('campaign-123')).rejects.toThrow(
        'Only draft campaigns can be deleted'
      );

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    });
  });

  describe('publishCampaign', () => {
    it('should change status from draft to published', async () => {
      const draftCampaign = {
        campaign_id: 'campaign-123',
        status: CampaignStatus.DRAFT,
        base_length: 3,
        positions_total: 6,
        positions_sold: 0,
        layer_prices: { '1': 100, '2': 200, '3': 300 },
        profit_margin_percent: 10,
        created_at: new Date(),
        updated_at: new Date(),
      };

      const publishedCampaign = { ...draftCampaign, status: CampaignStatus.PUBLISHED, updated_at: new Date() };

      // getCampaignById call inside updateCampaign
      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [draftCampaign] });

      mockClient.query
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [publishedCampaign] }) // UPDATE
        .mockResolvedValueOnce({ rows: [] }); // COMMIT

      const result = await service.publishCampaign('campaign-123');

      expect(result.status).toBe(CampaignStatus.PUBLISHED);
    });
  });

  describe('getCampaignStats', () => {
    it('should return campaign statistics', async () => {
      const mockStatsRow = {
        positions_total: '10',
        positions_sold: '5',
        progress_percent: '50.00',
        unique_buyers: '3',
        total_revenue: '1500',
      };

      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [mockStatsRow] });

      const result = await service.getCampaignStats('campaign-123');

      expect(result.positions_total).toBe(10);
      expect(result.positions_sold).toBe(5);
      expect(result.progress_percent).toBe(50);
      expect(result.unique_buyers).toBe(3);
      expect(result.total_revenue).toBe(1500);
    });

    it('should throw error if campaign not found', async () => {
      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

      await expect(service.getCampaignStats('non-existent')).rejects.toThrow('CAMPAIGN_NOT_FOUND');
    });
  });
});

