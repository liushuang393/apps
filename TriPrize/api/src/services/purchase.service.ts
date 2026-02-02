// import { PoolClient } from 'pg';
import { pool } from '../config/database.config';
import {
  Purchase,
  PurchaseStatus,
  PurchaseDetail,
  CreatePurchaseDto,
  mapRowToPurchase,
} from '../models/purchase.entity';
// import { PositionStatus } from '../models/campaign.entity';
import { generateUUID, sha256 } from '../utils/crypto.util';
import logger from '../utils/logger.util';
import lotteryService from './lottery.service';
import campaignService from './campaign.service';
import { CampaignStatus } from '../models/campaign.entity';
import { errors } from '../middleware/error.middleware';

/**
 * Purchase service for handling position purchases
 */
export class PurchaseService {
  /**
   * Create a new purchase with concurrency control
   * 目的: 抽選チケット購入を作成（自動位置割り当て対応）
   * 注意点:
   *   - quantity: 購入数量を指定した場合、サーバーが自動で位置を割り当て
   *   - position_ids: 後方互換性のため、指定された場合はそれを使用
   */
  async createPurchase(dto: CreatePurchaseDto, userId: string, idempotencyKey?: string): Promise<Purchase> {
    const client = await pool.connect();

    // 購入数量を決定（quantity > position_ids > デフォルト1）
    const requestedQuantity = dto.quantity || dto.position_ids?.length || 1;

    try {
      await client.query('BEGIN');
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');

      // Check campaign status
      const { rows: campaignRows } = await client.query<{ status: string; purchase_limit: number | null }>(
        'SELECT status, purchase_limit FROM campaigns WHERE campaign_id = $1',
        [dto.campaign_id]
      );

      if (campaignRows.length === 0) {
        logger.warn('Campaign not found for purchase', { campaignId: dto.campaign_id });
        throw errors.notFound('Campaign');
      }

      const campaign = campaignRows[0];

      if (campaign.status !== 'published') {
        logger.warn('Campaign is not available for purchase', {
          campaignId: dto.campaign_id,
          currentStatus: campaign.status,
          requiredStatus: 'published',
        });
        throw errors.badRequest(
          `Campaign is not available for purchase (current status: ${campaign.status}, required: published)`
        );
      }

      // Check purchase limit
      if (campaign.purchase_limit) {
        const { rows: userPurchaseRows } = await client.query<{ count: string }>(
          `SELECT COUNT(*) as count
           FROM purchases
           WHERE user_id = $1 AND campaign_id = $2 AND status IN ('pending', 'processing', 'completed')`,
          [userId, dto.campaign_id]
        );

        const currentPurchases = Number.parseInt(userPurchaseRows[0].count, 10);
        if (currentPurchases + requestedQuantity > campaign.purchase_limit) {
          logger.warn('Purchase limit exceeded', {
            userId,
            campaignId: dto.campaign_id,
            currentPurchases,
            requestedQuantity,
            purchaseLimit: campaign.purchase_limit,
          });
          throw errors.badRequest(
            `Purchase limit exceeded. Current: ${currentPurchases}, Requested: ${requestedQuantity}, Limit: ${campaign.purchase_limit}`
          );
        }
      }

      // 位置の取得: position_ids が指定されていればそれを使用、なければ自動割り当て
      let positionRows: { position_id: string; price: number; status: string }[];

      if (dto.position_ids && dto.position_ids.length > 0) {
        // 後方互換性: 指定された position_ids を使用
        const { rows } = await client.query<{ position_id: string; price: number; status: string }>(
          `SELECT position_id, price, status
           FROM positions
           WHERE position_id = ANY($1::uuid[])
             AND campaign_id = $2
             AND status = 'available'
           FOR UPDATE SKIP LOCKED`,
          [dto.position_ids, dto.campaign_id]
        );
        positionRows = rows;

        // Check if all positions were acquired
        if (positionRows.length !== dto.position_ids.length) {
          const acquiredIds = new Set(positionRows.map(r => r.position_id));
          const failedIds = dto.position_ids.filter(id => !acquiredIds.has(id));

          logger.warn('Some positions not available', {
            userId,
            campaignId: dto.campaign_id,
            requestedCount: dto.position_ids.length,
            acquiredCount: positionRows.length,
            failedIds,
          });

          throw errors.badRequest('Some positions are no longer available');
        }
      } else {
        // 自動割り当て: 利用可能な位置からランダムに選択
        const { rows } = await client.query<{ position_id: string; price: number; status: string }>(
          `SELECT position_id, price, status
           FROM positions
           WHERE campaign_id = $1
             AND status = 'available'
           ORDER BY RANDOM()
           LIMIT $2
           FOR UPDATE SKIP LOCKED`,
          [dto.campaign_id, requestedQuantity]
        );
        positionRows = rows;

        // Check if enough positions were acquired
        if (positionRows.length < requestedQuantity) {
          logger.warn('Not enough positions available', {
            userId,
            campaignId: dto.campaign_id,
            requestedCount: requestedQuantity,
            acquiredCount: positionRows.length,
          });

          throw errors.badRequest(`Not enough positions available. Only ${positionRows.length} positions left.`);
        }
      }

      // Calculate total amount
      const totalAmount = positionRows.reduce((sum, pos) => sum + pos.price, 0);

      // Generate base idempotency key if not provided
      // 目的: 冪等性キーの基盤を生成（各ポジションごとにユニークにする）
      // 注意点: クライアントから受け取った idempotency_key を優先使用
      const baseIdempotencyKey = dto.idempotency_key || idempotencyKey || sha256(
        JSON.stringify({ userId, campaignId: dto.campaign_id, positionCount: positionRows.length, timestamp: Date.now() })
      );

      // Create purchase records
      // 目的: 購入レコードを作成し、ポジションを予約状態にする
      // 注意点: APIの payment_method ('card'|'konbini') を
      //         DBの purchase_method ('credit_card'|'debit_card'|'konbini') に変換
      const purchases: Purchase[] = [];
      // 'card' -> 'credit_card' に変換（DB CHECK制約に対応）
      const purchaseMethod = dto.payment_method === 'card' ? 'credit_card' : (dto.payment_method || 'credit_card');
      for (const position of positionRows) {
        const purchaseId = generateUUID();
        // 各ポジションごとにユニークな idempotency_key を生成
        // 注意点: DB の UNIQUE 制約を満たすため、position_id を追加
        const positionIdempotencyKey = sha256(`${baseIdempotencyKey}-${position.position_id}`);

        // Insert purchase
        const { rows: purchaseRows } = await client.query<Purchase>(
          `INSERT INTO purchases (
            purchase_id, user_id, campaign_id, position_id,
            quantity, price_per_position, total_amount, status,
            purchase_method, idempotency_key, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9, NOW(), NOW())
          RETURNING *`,
          [
            purchaseId,
            userId,
            dto.campaign_id,
            position.position_id,
            1,
            position.price,
            position.price,
            purchaseMethod,
            positionIdempotencyKey,
          ]
        );

        purchases.push(mapRowToPurchase(purchaseRows[0]));

        // Mark position as reserved
        await client.query(
          `UPDATE positions
           SET status = 'reserved', user_id = $1, updated_at = NOW()
           WHERE position_id = $2`,
          [userId, position.position_id]
        );
      }

      // Update campaign positions_sold count
      await client.query(
        `UPDATE campaigns
         SET positions_sold = positions_sold + $1, updated_at = NOW()
         WHERE campaign_id = $2`,
        [positionRows.length, dto.campaign_id]
      );

      // Update user stats
      await client.query(
        `UPDATE users
         SET total_purchases = total_purchases + $1,
             total_spent = total_spent + $2,
             updated_at = NOW()
         WHERE user_id = $3`,
        [positionRows.length, totalAmount, userId]
      );

      await client.query('COMMIT');

      logger.info('Purchase created successfully', {
        userId,
        campaignId: dto.campaign_id,
        positionCount: positionRows.length,
        totalAmount,
      });

      // Return the first purchase (or aggregate if needed)
      return purchases[0];
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to create purchase', {
        error: errorMessage,
        userId,
        dto,
      });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get purchase by ID
   */
  async getPurchaseById(purchaseId: string): Promise<Purchase | null> {
    try {
      const { rows } = await pool.query<Purchase>(
        'SELECT * FROM purchases WHERE purchase_id = $1',
        [purchaseId]
      );

      if (rows.length === 0) {
        return null;
      }

      return mapRowToPurchase(rows[0]);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to get purchase', { error: errorMessage, purchaseId });
      throw error;
    }
  }

  /**
   * Get user purchases
   */
  async getUserPurchases(
    userId: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<PurchaseDetail[]> {
    try {
      interface PurchaseRow extends Purchase {
        campaign_name: string;
        position_row: number;
        position_col: number;
        position_layer: number;
      }

      const { rows } = await pool.query<PurchaseRow>(
        `SELECT
          p.*,
          c.name as campaign_name,
          pos.row_number as position_row,
          pos.col_number as position_col,
          pos.layer_number as position_layer
         FROM purchases p
         JOIN campaigns c ON p.campaign_id = c.campaign_id
         JOIN positions pos ON p.position_id = pos.position_id
         WHERE p.user_id = $1
         ORDER BY p.created_at DESC
         LIMIT $2 OFFSET $3`,
        [userId, limit, offset]
      );

      return rows.map((row) => ({
        ...mapRowToPurchase(row),
        campaign_name: row.campaign_name,
        position_row: row.position_row,
        position_col: row.position_col,
        position_layer: row.position_layer,
      }));
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to get user purchases', { error: errorMessage, userId });
      throw error;
    }
  }

  /**
   * Update purchase status
   */
  async updatePurchaseStatus(
    purchaseId: string,
    status: PurchaseStatus,
    paymentIntentId?: string
  ): Promise<Purchase> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Update purchase
      // 注意点: $1::text で明示的に型を指定し、PostgreSQL の型推論エラーを回避
      const { rows: purchaseRows } = await client.query<Purchase>(
        `UPDATE purchases
         SET status = $1::text,
             payment_intent_id = COALESCE($2::text, payment_intent_id),
             completed_at = CASE WHEN $1::text = 'completed' THEN NOW() ELSE completed_at END,
             updated_at = NOW()
         WHERE purchase_id = $3::uuid
         RETURNING *`,
        [status, paymentIntentId || null, purchaseId]
      );

      if (purchaseRows.length === 0) {
        throw new Error('PURCHASE_NOT_FOUND');
      }

      const purchase = mapRowToPurchase(purchaseRows[0]);

      // If completed, mark position as sold
      // 注意: position_user_consistency と sold_timestamp_consistency 約束を満たすため、user_id と sold_at も設定
      if (status === PurchaseStatus.COMPLETED) {
        await client.query(
          `UPDATE positions
           SET status = 'sold', user_id = $1, sold_at = NOW(), updated_at = NOW()
           WHERE position_id = $2`,
          [purchase.user_id, purchase.position_id]
        );
      }

      // If failed or refunded, mark position as available again
      // 注意: sold_timestamp_consistency 約束により、status='available' の場合は sold_at を NULL にする必要がある
      if (status === PurchaseStatus.FAILED || status === PurchaseStatus.REFUNDED) {
        await client.query(
          `UPDATE positions
           SET status = 'available', user_id = NULL, sold_at = NULL, updated_at = NOW()
           WHERE position_id = $1`,
          [purchase.position_id]
        );

        // Decrement campaign positions_sold
        await client.query(
          `UPDATE campaigns
           SET positions_sold = positions_sold - 1, updated_at = NOW()
           WHERE campaign_id = $1`,
          [purchase.campaign_id]
        );

        // Decrement user stats
        await client.query(
          `UPDATE users
           SET total_purchases = total_purchases - 1,
               total_spent = total_spent - $1,
               updated_at = NOW()
           WHERE user_id = $2`,
          [purchase.total_amount, purchase.user_id]
        );
      }

      await client.query('COMMIT');

      logger.info('Purchase status updated', {
        purchaseId,
        status,
        paymentIntentId,
      });

      // 自動開獎チェック: 購買完了後、トランザクション外で実行
      // 目的: キャンペーンのauto_drawがtrueの場合、購買完了後に自動的に開獎を実行
      // 注意点: エラーが発生しても購買完了はロールバックしない（非同期で実行）
      if (status === PurchaseStatus.COMPLETED) {
        this.checkAndAutoDraw(purchase.campaign_id, purchaseId).catch((err: unknown) => {
          const errorMessage = err instanceof Error ? err.message : 'Unknown error';
          logger.error('Failed to check auto-draw after purchase completion', {
            error: errorMessage,
            campaignId: purchase.campaign_id,
            purchaseId,
          });
        });
      }

      return purchase;
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to update purchase status', {
        error: errorMessage,
        purchaseId,
        status,
      });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Check and auto-draw lottery if conditions are met
   * 目的: キャンペーンのauto_drawがtrueで、条件を満たす場合に自動開獎を実行
   * I/O: campaignId → void (非同期)
   * 注意点: エラーが発生してもログに記録するのみ
   */
  private async checkAndAutoDraw(campaignId: string, purchaseId: string): Promise<void> {
    try {
      // トランザクション外でキャンペーン情報を取得
      const campaign = await campaignService.getCampaignById(campaignId);
      if (!campaign || !campaign.auto_draw) {
        return; // 自動開獎が無効な場合は何もしない
      }

      // キャンペーンが全て売り切れた場合、またはキャンペーン終了後に自動開獎
      const now = new Date();
      const isSoldOut = campaign.positions_sold >= campaign.positions_total;
      const isEnded = campaign.end_date && new Date(campaign.end_date) <= now;
      const canAutoDraw = isSoldOut || isEnded;

      if (canAutoDraw && campaign.status !== CampaignStatus.DRAWN) {
        logger.info('Auto-drawing lottery after purchase completion', {
          campaignId,
          purchaseId,
          reason: isSoldOut ? 'sold_out' : 'ended',
          positionsSold: campaign.positions_sold,
          positionsTotal: campaign.positions_total,
        });

        // 非同期で実行（awaitしない）
        await lotteryService.drawLottery(campaignId);
      }
    } catch (autoDrawError: unknown) {
      // 自動開獎のエラーはログに記録するが、購買完了は成功とする
      const errorMessage = autoDrawError instanceof Error ? autoDrawError.message : 'Unknown error';
      logger.error('Auto-draw failed after purchase completion', {
        error: errorMessage,
        campaignId,
        purchaseId,
      });
      // エラーを再スローしない（購買完了は成功とする）
    }
  }

  /**
   * Cancel purchase (within allowed timeframe)
   */
  async cancelPurchase(purchaseId: string, userId: string): Promise<void> {
    try {
      const purchase = await this.getPurchaseById(purchaseId);

      if (!purchase) {
        throw new Error('PURCHASE_NOT_FOUND');
      }

      if (purchase.user_id !== userId) {
        throw new Error('FORBIDDEN');
      }

      if (purchase.status !== PurchaseStatus.PENDING && purchase.status !== PurchaseStatus.PROCESSING) {
        throw new Error('Purchase cannot be cancelled');
      }

      await this.updatePurchaseStatus(purchaseId, PurchaseStatus.FAILED);

      logger.info('Purchase cancelled', { purchaseId, userId });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to cancel purchase', {
        error: errorMessage,
        purchaseId,
        userId,
      });
      throw error;
    }
  }
}

export default new PurchaseService();
