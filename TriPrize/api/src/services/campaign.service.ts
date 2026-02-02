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
  Position,
  PositionStatus,
  mapRowToCampaign,
  mapRowToLayer,
  mapRowToPrize,
} from '../models/campaign.entity';
import {
  calculateTotalPositions,
  calculateLayerPositions,
  generatePositions,
  validateLayerPrices,
  calculateTicketPrice,
} from '../utils/position-calculator.util';
import logger from '../utils/logger.util';
import { generateUUID } from '../utils/crypto.util';
import { errors } from '../middleware/error.middleware';

/**
 * キャンペーン一覧用の行データ
 * 目的: listCampaigns クエリ結果のマッピング
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
  ticket_price: number | null; // 統一抽選価格（自動計算値）
  manual_ticket_price: number | null; // 手動設定の抽選価格（円）
  effective_ticket_price: number | null; // 有効な抽選価格（手動優先）
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
        throw errors.badRequest('Invalid layer prices configuration');
      }

      // Calculate total positions
      const positionsTotal = calculateTotalPositions(dto.base_length);

      // Calculate uniform ticket price
      // 目的: すべてのポジションに適用される統一抽選価格を計算
      // 計算式: (総奖品成本 / (1 - 利润率)) / 総格子数
      const ticketPrice = calculateTicketPrice(
        dto.layer_prices,
        dto.base_length,
        dto.profit_margin_percent
      );

      // Generate campaign ID
      const campaignId = generateUUID();

      // Insert campaign
      // 目的: キャンペーンを作成し、auto_drawフラグと統一価格を設定
      // I/O: CreateCampaignDto → CampaignDetail
      // 注意点: manual_ticket_price が設定されている場合、それを優先
      const autoDraw = dto.auto_draw ?? true; // デフォルト: 自動開獎
      const manualTicketPrice = dto.manual_ticket_price ?? null; // 手動設定価格（未設定はnull）
      const { rows: campaignRows } = await client.query<Campaign>(
        `INSERT INTO campaigns (
          campaign_id, name, description, base_length, positions_total,
          layer_prices, profit_margin_percent, purchase_limit,
          start_date, end_date, status, auto_draw, ticket_price, manual_ticket_price, created_by, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'draft', $11, $12, $13, $14, NOW(), NOW())
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
          autoDraw,
          ticketPrice, // 統一抽選価格（自動計算値）をDBに保存
          manualTicketPrice, // 手動設定の抽選価格（円）
          creatorId,
        ]
      );

      const campaign = mapRowToCampaign(campaignRows[0]);

      // Create layers and store layer_id mapping
      // 目的: 各レイヤーを作成（price は奖品価値を保存、prize_name は顧客表示用）
      const layers: Layer[] = [];
      const layerIdMap: { [layerNumber: number]: string } = {};
      for (let layerNumber = 1; layerNumber <= dto.base_length; layerNumber++) {
        const positionsCount = calculateLayerPositions(dto.base_length, layerNumber);
        const prizeValue = dto.layer_prices[layerNumber.toString()]; // 该层奖品的价值
        // 賞品名: layer_names から取得、なければデフォルト(N等賞)
        const prizeName = dto.layer_names?.[layerNumber.toString()] || `${layerNumber}等賞`;

        const { rows: layerRows } = await client.query<Layer>(
          `INSERT INTO layers (campaign_id, layer_number, positions_count, price, prize_name, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
           RETURNING *`,
          [campaignId, layerNumber, positionsCount, prizeValue, prizeName]
        );

        const layer = mapRowToLayer(layerRows[0]);
        layers.push(layer);
        layerIdMap[layerNumber] = layer.layer_id;
      }

      // Create positions with layer_id
      // 目的: すべてのポジションに統一の ticket_price を設定
      // 注意点: 手動価格が設定されている場合はそれを優先
      const effectiveTicketPrice = manualTicketPrice ?? ticketPrice;
      const positions = generatePositions(dto.base_length);
      for (const pos of positions) {
        const layerId = layerIdMap[pos.layerNumber];

        await client.query(
          `INSERT INTO positions (campaign_id, layer_id, layer_number, row_number, col_number, price, status, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'available', NOW(), NOW())`,
          [campaignId, layerId, pos.layerNumber, pos.rowNumber, pos.colNumber, effectiveTicketPrice]
        );
      }

      // Create prizes - 自動生成：各層から1つの賞品を作成
      // 目的: 等級と賞品を一対一で対応させる
      // 注意点: layer_names と layer_prices から自動生成し、dto.prizes は無視
      const prizes: Prize[] = [];
      for (let layerNumber = 1; layerNumber <= dto.base_length; layerNumber++) {
        const prizeValue = dto.layer_prices[layerNumber.toString()];
        const prizeName = dto.layer_names?.[layerNumber.toString()] || `${layerNumber}等賞`;

        // 賞品価値が設定されている層のみ賞品を作成
        if (prizeValue && prizeValue > 0) {
          const { rows: prizeRows } = await client.query<Prize>(
            `INSERT INTO prizes (campaign_id, name, description, rank, quantity, value, image_url, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
             RETURNING *`,
            [
              campaignId,
              prizeName,
              `${layerNumber}等の賞品`, // デフォルト説明
              layerNumber, // rank = layer_number
              1, // quantity = 1（各層1人当選）
              prizeValue,
              null, // image_url
            ]
          );

          prizes.push(mapRowToPrize(prizeRows[0]));
        }
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
   * 目的: キャンペーン一覧を取得
   * 注意点:
   *   - includeAll=false（デフォルト）の場合、draftを除外（顧客向け）
   *   - includeAll=trueの場合、すべてのステータスを返す（管理者向け）
   */
  async listCampaigns(
    status?: CampaignStatus,
    limit: number = 50,
    offset: number = 0,
    includeAll: boolean = false
  ): Promise<CampaignListItem[]> {
    try {
      // 目的: キャンペーン一覧を取得（手動価格対応）
      // 注意点: effective_ticket_price = COALESCE(manual_ticket_price, ticket_price)
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
          COALESCE(ticket_price, 0) as ticket_price,
          manual_ticket_price,
          COALESCE(manual_ticket_price, ticket_price, 0) as effective_ticket_price,
          status,
          end_date,
          created_at
        FROM campaigns
      `;

      const params: (CampaignStatus | number)[] = [];

      // ステータスフィルタリング
      if (status) {
        // 特定のステータスが指定された場合
        query += ' WHERE status = $1';
        params.push(status);
      } else if (!includeAll) {
        // includeAll=false の場合、draft を除外（顧客向け）
        query += " WHERE status != 'draft'";
      }
      // includeAll=true かつ status 未指定の場合は WHERE なし（管理者向け）

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
        ticket_price: Number.parseInt(String(row.ticket_price ?? 0), 10),
        manual_ticket_price: row.manual_ticket_price ? Number.parseInt(String(row.manual_ticket_price), 10) : null,
        effective_ticket_price: Number.parseInt(String(row.effective_ticket_price ?? 0), 10),
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
        throw errors.notFound('Campaign');
      }

      // Don't allow updates to published/closed/drawn campaigns
      if (existing.status !== CampaignStatus.DRAFT && dto.layer_prices) {
        throw errors.badRequest('Cannot update layer prices after campaign is published');
      }

      const updates: string[] = [];
      const values: (string | number | boolean | null | Record<string, number> | Date)[] = [];
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
          throw errors.badRequest('Invalid layer prices configuration');
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

      if (dto.auto_draw !== undefined) {
        updates.push(`auto_draw = $${paramIndex++}`);
        values.push(dto.auto_draw);
      }

      // 手動設定の抽選価格（円）を更新
      // 注意点: null を明示的に設定すると自動計算に戻る
      if (dto.manual_ticket_price !== undefined) {
        updates.push(`manual_ticket_price = $${paramIndex++}`);
        values.push(dto.manual_ticket_price);
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

      // 手動価格が変更された場合、全てのポジションの価格も更新
      // 目的: 購入時に正しい価格を使用できるようにする
      if (dto.manual_ticket_price !== undefined) {
        const updatedCampaign = mapRowToCampaign(rows[0]);
        const effectivePrice = updatedCampaign.manual_ticket_price ?? updatedCampaign.ticket_price;
        await client.query(
          'UPDATE positions SET price = $1, updated_at = NOW() WHERE campaign_id = $2',
          [effectivePrice, campaignId]
        );
        logger.info(`Updated all positions price to ${effectivePrice} for campaign ${campaignId}`);
      }

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
        throw errors.notFound('Campaign');
      }

      if (campaign.status !== CampaignStatus.DRAFT) {
        throw errors.badRequest('Only draft campaigns can be deleted');
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
        throw errors.notFound('Campaign');
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

  /**
   * Get positions for a campaign
   * 目的: キャンペーンの位置情報を取得する
   * I/O: campaignId, status (optional), limit (optional) -> Position[]
   */
  async getPositions(
    campaignId: string,
    status?: string,
    limit: number = 100
  ): Promise<Position[]> {
    try {
      // キャンペーンの存在確認
      const campaign = await this.getCampaignById(campaignId);
      if (!campaign) {
        throw errors.notFound('Campaign');
      }

      let query = `
        SELECT 
          position_id,
          campaign_id,
          layer_id,
          layer_number,
          row_number,
          col_number,
          price,
          status,
          user_id,
          created_at,
          updated_at
        FROM positions
        WHERE campaign_id = $1
      `;
      
      const params: (string | number)[] = [campaignId];
      
      if (status) {
        query += ' AND status = $2';
        params.push(status);
      }
      
      query += ' ORDER BY layer_number ASC, row_number ASC, col_number ASC';
      query += ` LIMIT $${params.length + 1}`;
      params.push(limit);

      const { rows } = await pool.query(query, params);

      return rows.map((row: Record<string, unknown>) => ({
        position_id: String(row.position_id),
        campaign_id: String(row.campaign_id),
        layer_number: Number.parseInt(String(row.layer_number), 10),
        row_number: Number.parseInt(String(row.row_number), 10),
        col_number: Number.parseInt(String(row.col_number), 10),
        price: Number.parseInt(String(row.price), 10),
        status: String(row.status) as PositionStatus,
        user_id: row.user_id ? String(row.user_id) : null,
        created_at: new Date(String(row.created_at)),
        updated_at: new Date(String(row.updated_at)),
      }));
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to get positions', { error: errorMessage, campaignId, status });
      throw error;
    }
  }
}

export default new CampaignService();
