import { pool } from '../config/database.config';
import {
  Campaign,
  CampaignStatus,
  CampaignDetail,
  CampaignListItem,
  CreateCampaignDto,
  UpdateCampaignDto,
  Layer,
  Prize,
  mapRowToCampaign,
  mapRowToLayer,
  mapRowToPrize,
} from '../models/campaign.entity';
import {
  calculateTotalPositions,
  calculateLayerPositions,
  generatePositions,
  validateLayerPrices,
} from '../utils/position-calculator.util';
import logger from '../utils/logger.util';
import { generateUUID } from '../utils/crypto.util';

/**
 * Database row types for campaign queries
 */
interface CampaignListRow {
  campaign_id: string;
  name: string;
  description: string | null;
  base_length: number;
  positions_total: number;
  positions_sold: number;
  progress_percent: string;
  min_price: number;
  max_price: number;
  status: string;
  end_date: Date | null;
  created_at: Date;
}

interface CampaignStatsRow {
  positions_total: number;
  positions_sold: number;
  progress_percent: string;
  unique_buyers: string;
  total_revenue: string;
}

/**
 * Campaign service for managing campaigns
 */
export class CampaignService {
  /**
   * Create a new campaign
   */
  async createCampaign(dto: CreateCampaignDto, creatorId: string): Promise<CampaignDetail> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Validate layer prices
      if (!validateLayerPrices(dto.layer_prices, dto.base_length)) {
        throw new Error('Invalid layer prices configuration');
      }

      // Calculate total positions
      const positionsTotal = calculateTotalPositions(dto.base_length);

      // Generate campaign ID
      const campaignId = generateUUID();

      // Insert campaign
      const { rows: campaignRows } = await client.query<Campaign>(
        `INSERT INTO campaigns (
          campaign_id, name, description, base_length, positions_total,
          layer_prices, profit_margin_percent, purchase_limit,
          start_date, end_date, status, created_by, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'draft', $11, NOW(), NOW())
        RETURNING *`,
        [
          campaignId,
          dto.name,
          dto.description || null,
          dto.base_length,
          positionsTotal,
          JSON.stringify(dto.layer_prices),
          dto.profit_margin_percent,
          dto.purchase_limit || null,
          dto.start_date || null,
          dto.end_date || null,
          creatorId,
        ]
      );

      const campaign = mapRowToCampaign(campaignRows[0]);

      // Create layers and store layer_id mapping
      const layers: Layer[] = [];
      const layerIdMap: { [layerNumber: number]: string } = {};
      for (let layerNumber = 1; layerNumber <= dto.base_length; layerNumber++) {
        const positionsCount = calculateLayerPositions(dto.base_length, layerNumber);
        const price = dto.layer_prices[layerNumber.toString()];

        const { rows: layerRows } = await client.query<Layer>(
          `INSERT INTO layers (campaign_id, layer_number, positions_count, price, created_at, updated_at)
           VALUES ($1, $2, $3, $4, NOW(), NOW())
           RETURNING *`,
          [campaignId, layerNumber, positionsCount, price]
        );

        const layer = mapRowToLayer(layerRows[0]);
        layers.push(layer);
        layerIdMap[layerNumber] = layer.layer_id;
      }

      // Create positions with layer_id
      const positions = generatePositions(dto.base_length);
      for (const pos of positions) {
        const price = dto.layer_prices[pos.layerNumber.toString()];
        const layerId = layerIdMap[pos.layerNumber];

        await client.query(
          `INSERT INTO positions (campaign_id, layer_id, layer_number, row_number, col_number, price, status, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'available', NOW(), NOW())`,
          [campaignId, layerId, pos.layerNumber, pos.rowNumber, pos.colNumber, price]
        );
      }

      // Create prizes
      const prizes: Prize[] = [];
      for (const prizeDto of dto.prizes) {
        const { rows: prizeRows } = await client.query<Prize>(
          `INSERT INTO prizes (campaign_id, name, description, rank, quantity, value, image_url, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
           RETURNING *`,
          [
            campaignId,
            prizeDto.name,
            prizeDto.description || null,
            prizeDto.rank,
            prizeDto.quantity,
            prizeDto.value,
            prizeDto.image_url || null,
          ]
        );

        prizes.push(mapRowToPrize(prizeRows[0]));
      }

      await client.query('COMMIT');

      logger.info(`Campaign created: ${campaignId}`, { name: dto.name, creatorId });

      return {
        ...campaign,
        layers,
        prizes,
      };
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to create campaign', { error: errorMessage, dto });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get campaign by ID
   */
  async getCampaignById(campaignId: string): Promise<Campaign | null> {
    try {
      const { rows } = await pool.query<Campaign>(
        'SELECT * FROM campaigns WHERE campaign_id = $1',
        [campaignId]
      );

      if (rows.length === 0) {
        return null;
      }

      return mapRowToCampaign(rows[0]);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to get campaign', { error: errorMessage, campaignId });
      throw error;
    }
  }

  /**
   * Get campaign detail with layers and prizes
   */
  async getCampaignDetail(campaignId: string): Promise<CampaignDetail | null> {
    try {
      // Get campaign
      const campaign = await this.getCampaignById(campaignId);
      if (!campaign) {
        return null;
      }

      // Get layers
      const { rows: layerRows } = await pool.query(
        'SELECT * FROM layers WHERE campaign_id = $1 ORDER BY layer_number ASC',
        [campaignId]
      );
      const layers = layerRows.map(mapRowToLayer);

      // Get prizes
      const { rows: prizeRows } = await pool.query(
        'SELECT * FROM prizes WHERE campaign_id = $1 ORDER BY rank ASC',
        [campaignId]
      );
      const prizes = prizeRows.map(mapRowToPrize);

      return {
        ...campaign,
        layers,
        prizes,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to get campaign detail', { error: errorMessage, campaignId });
      throw error;
    }
  }

  /**
   * List campaigns with filters
   */
  async listCampaigns(
    status?: CampaignStatus,
    limit: number = 50,
    offset: number = 0
  ): Promise<CampaignListItem[]> {
    try {
      let query = `
        SELECT
          campaign_id,
          name,
          description,
          base_length,
          positions_total,
          positions_sold,
          ROUND((positions_sold::decimal / positions_total * 100), 2) as progress_percent,
          (layer_prices->>'1')::integer as min_price,
          (layer_prices->>base_length::text)::integer as max_price,
          status,
          end_date,
          created_at
        FROM campaigns
      `;

      const params: (CampaignStatus | number)[] = [];
      if (status) {
        query += ' WHERE status = $1';
        params.push(status);
      }

      query += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
      params.push(limit, offset);

      const { rows } = await pool.query<CampaignListRow>(query, params);

      return rows.map((row) => ({
        campaign_id: String(row.campaign_id),
        name: String(row.name),
        description: row.description ? String(row.description) : null,
        base_length: Number.parseInt(String(row.base_length), 10),
        positions_total: Number.parseInt(String(row.positions_total), 10),
        positions_sold: Number.parseInt(String(row.positions_sold), 10),
        progress_percent: Number.parseFloat(String(row.progress_percent)),
        min_price: Number.parseInt(String(row.min_price), 10),
        max_price: Number.parseInt(String(row.max_price), 10),
        status: row.status as CampaignStatus,
        end_date: row.end_date ? new Date(row.end_date) : null,
        created_at: new Date(row.created_at),
      }));
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to list campaigns', { error: errorMessage, status });
      throw error;
    }
  }

  /**
   * Update campaign
   */
  async updateCampaign(campaignId: string, dto: UpdateCampaignDto): Promise<Campaign> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Get existing campaign
      const existing = await this.getCampaignById(campaignId);
      if (!existing) {
        throw new Error('CAMPAIGN_NOT_FOUND');
      }

      // Don't allow updates to published/closed/drawn campaigns
      if (existing.status !== CampaignStatus.DRAFT && dto.layer_prices) {
        throw new Error('Cannot update layer prices after campaign is published');
      }

      const updates: string[] = [];
      const values: (string | number | null | Record<string, number> | Date)[] = [];
      let paramIndex = 1;

      if (dto.name !== undefined) {
        updates.push(`name = $${paramIndex++}`);
        values.push(dto.name);
      }

      if (dto.description !== undefined) {
        updates.push(`description = $${paramIndex++}`);
        values.push(dto.description);
      }

      if (dto.layer_prices !== undefined) {
        // Validate new prices
        if (!validateLayerPrices(dto.layer_prices, existing.base_length)) {
          throw new Error('Invalid layer prices configuration');
        }

        updates.push(`layer_prices = $${paramIndex++}`);
        values.push(JSON.stringify(dto.layer_prices));

        // Update layer and position prices
        for (let layerNumber = 1; layerNumber <= existing.base_length; layerNumber++) {
          const newPrice = dto.layer_prices[layerNumber.toString()];

          await client.query(
            'UPDATE layers SET price = $1, updated_at = NOW() WHERE campaign_id = $2 AND layer_number = $3',
            [newPrice, campaignId, layerNumber]
          );

          await client.query(
            'UPDATE positions SET price = $1, updated_at = NOW() WHERE campaign_id = $2 AND layer_number = $3',
            [newPrice, campaignId, layerNumber]
          );
        }
      }

      if (dto.profit_margin_percent !== undefined) {
        updates.push(`profit_margin_percent = $${paramIndex++}`);
        values.push(dto.profit_margin_percent);
      }

      if (dto.purchase_limit !== undefined) {
        updates.push(`purchase_limit = $${paramIndex++}`);
        values.push(dto.purchase_limit);
      }

      if (dto.start_date !== undefined) {
        updates.push(`start_date = $${paramIndex++}`);
        values.push(dto.start_date);
      }

      if (dto.end_date !== undefined) {
        updates.push(`end_date = $${paramIndex++}`);
        values.push(dto.end_date);
      }

      if (dto.status !== undefined) {
        updates.push(`status = $${paramIndex++}`);
        values.push(dto.status);
      }

      if (updates.length === 0) {
        await client.query('ROLLBACK');
        return existing;
      }

      updates.push(`updated_at = NOW()`);
      values.push(campaignId);

      const query = `
        UPDATE campaigns
        SET ${updates.join(', ')}
        WHERE campaign_id = $${paramIndex}
        RETURNING *
      `;

      const { rows } = await client.query<Campaign>(query, values);

      await client.query('COMMIT');

      const updated = mapRowToCampaign(rows[0]);
      logger.info(`Campaign updated: ${campaignId}`, { updates: Object.keys(dto) });

      return updated;
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to update campaign', { error: errorMessage, campaignId, dto });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Delete campaign (only drafts)
   */
  async deleteCampaign(campaignId: string): Promise<void> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Check if draft
      const campaign = await this.getCampaignById(campaignId);
      if (!campaign) {
        throw new Error('CAMPAIGN_NOT_FOUND');
      }

      if (campaign.status !== CampaignStatus.DRAFT) {
        throw new Error('Only draft campaigns can be deleted');
      }

      // Delete campaign (cascade will delete layers, positions, prizes)
      await client.query('DELETE FROM campaigns WHERE campaign_id = $1', [campaignId]);

      await client.query('COMMIT');

      logger.info(`Campaign deleted: ${campaignId}`);
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to delete campaign', { error: errorMessage, campaignId });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Publish campaign (change status from draft to published)
   */
  async publishCampaign(campaignId: string): Promise<Campaign> {
    return await this.updateCampaign(campaignId, {
      status: CampaignStatus.PUBLISHED,
    });
  }

  /**
   * Close campaign (no more purchases allowed)
   */
  async closeCampaign(campaignId: string): Promise<Campaign> {
    return await this.updateCampaign(campaignId, {
      status: CampaignStatus.CLOSED,
    });
  }

  /**
   * Get campaign statistics
   */
  async getCampaignStats(campaignId: string): Promise<{
    positions_total: number;
    positions_sold: number;
    positions_available: number;
    progress_percent: number;
    unique_buyers: number;
    total_revenue: number;
  }> {
    try {
      const { rows } = await pool.query<CampaignStatsRow>(
        `SELECT
          c.positions_total,
          c.positions_sold,
          ROUND((c.positions_sold::decimal / c.positions_total * 100), 2) as progress_percent,
          COUNT(DISTINCT p.user_id) as unique_buyers,
          COALESCE(SUM(pos.price), 0) as total_revenue
        FROM campaigns c
        LEFT JOIN purchases p ON c.campaign_id = p.campaign_id AND p.status = 'completed'
        LEFT JOIN positions pos ON p.position_id = pos.position_id
        WHERE c.campaign_id = $1
        GROUP BY c.campaign_id, c.positions_total, c.positions_sold`,
        [campaignId]
      );

      if (rows.length === 0) {
        throw new Error('CAMPAIGN_NOT_FOUND');
      }

      const row = rows[0];
      const positionsTotal = Number.parseInt(String(row.positions_total), 10);
      const positionsSold = Number.parseInt(String(row.positions_sold), 10);
      return {
        positions_total: positionsTotal,
        positions_sold: positionsSold,
        positions_available: positionsTotal - positionsSold,
        progress_percent: Number.parseFloat(String(row.progress_percent)),
        unique_buyers: Number.parseInt(String(row.unique_buyers), 10),
        total_revenue: Number.parseInt(String(row.total_revenue), 10),
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to get campaign stats', { error: errorMessage, campaignId });
      throw error;
    }
  }
}

export default new CampaignService();
