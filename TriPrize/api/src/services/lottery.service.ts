import { pool } from '../config/database.config';
import {
  LotteryResult,
  Winner,
  LotteryDrawSummary,
  mapRowToLotteryResult,
} from '../models/lottery.entity';
import { CampaignStatus } from '../models/campaign.entity';
import campaignService from './campaign.service';
import notificationService, { NotificationType } from './notification.service';
import { generateUUID } from '../utils/crypto.util';
import logger from '../utils/logger.util';
import { errors } from '../middleware/error.middleware';

/**
 * Lottery service for drawing winners
 */
export class LotteryService {
  /**
   * Perform lottery draw for a campaign
   */
  async drawLottery(campaignId: string): Promise<LotteryDrawSummary> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      await client.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');

      // Acquire advisory lock for this campaign
      // This ensures only one lottery draw can happen at a time
      const lockId = this.campaignIdToLockId(campaignId);
      const { rows: lockRows } = await client.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_xact_lock($1) as locked',
        [lockId]
      );

      if (!lockRows[0].locked) {
        throw errors.conflict('Lottery draw already in progress for this campaign');
      }

      // Get campaign details
      const campaign = await campaignService.getCampaignDetail(campaignId);

      if (!campaign) {
        throw errors.notFound('Campaign');
      }

      // Verify campaign can be drawn
      // 目的: キャンペーンが開獎可能な状態かチェック
      // 注意点: 自動開獎の場合はpublished状態でも開獎可能、手動開獎の場合はclosed状態が必要
      const canDraw = campaign.status === CampaignStatus.CLOSED ||
                      campaign.status === CampaignStatus.PUBLISHED;

      if (!canDraw) {
        throw errors.badRequest(`Campaign must be closed or published before drawing lottery. Current status: ${campaign.status}`);
      }

      // キャンペーンが終了しているか、全て売り切れているかチェック
      const now = new Date();
      const isEnded = campaign.end_date && new Date(campaign.end_date) <= now;
      const isSoldOut = campaign.positions_sold >= campaign.positions_total;

      if (!isEnded && !isSoldOut) {
        throw errors.badRequest('Campaign must be ended or sold out before drawing lottery');
      }

      // Check if already drawn
      const { rows: existingResults } = await client.query<{ count: string }>(
        'SELECT COUNT(*) as count FROM lottery_results WHERE campaign_id = $1',
        [campaignId]
      );

      if (Number.parseInt(existingResults[0].count, 10) > 0) {
        throw errors.conflict('Lottery already drawn for this campaign');
      }

      // Get all sold positions with user info
      interface SoldPosition {
        position_id: string;
        user_id: string;
        row_number: number;
        col_number: number;
        layer_number: number;
      }

      // 販売済みポジション総数を取得
      const { rows: soldCountRows } = await client.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM positions
         WHERE campaign_id = $1 AND status = 'sold' AND user_id IS NOT NULL`,
        [campaignId]
      );
      const soldPositionsCount = Number.parseInt(soldCountRows[0].count, 10);

      logger.info(`Drawing lottery for campaign ${campaignId}`, {
        totalPositions: campaign.positions_total,
        soldPositions: soldPositionsCount,
        prizes: campaign.prizes.length,
      });

      const winners: Winner[] = [];

      // 抽選ロジック: 各レイヤーから1人を抽選
      // 目的: layer_prices に設定された各層から当選者を選出
      // 注意点: prizes テーブルに詳細があればそれを使用、なければ layer_prices の価値を使用
      const layerPrices = campaign.layer_prices as Record<string, number>;

      for (let layerNumber = 1; layerNumber <= campaign.base_length; layerNumber++) {
        const prizeValue = layerPrices[layerNumber.toString()];

        // 该层是否有设置奖品价值
        if (!prizeValue || prizeValue <= 0) {
          logger.info(`Layer ${layerNumber} has no prize value, skipping`, { campaignId });
          continue;
        }

        // このレイヤーの販売済みポジションを取得（ランダム順）
        const { rows: layerPositions } = await client.query<SoldPosition>(
          `SELECT p.position_id, p.user_id, p.row_number, p.col_number, p.layer_number
           FROM positions p
           WHERE p.campaign_id = $1
             AND p.status = 'sold'
             AND p.user_id IS NOT NULL
             AND p.layer_number = $2
           ORDER BY RANDOM()
           LIMIT 1`,
          [campaignId, layerNumber]
        );

        if (layerPositions.length === 0) {
          logger.warn('No sold positions in layer, skipping', {
            campaignId,
            layerNumber,
          });
          continue;
        }

        const winningPosition = layerPositions[0];

        // prizes テーブルからこのランクの詳細を取得（あれば）
        const matchingPrize = campaign.prizes.find(p => p.rank === layerNumber);
        const prizeName = matchingPrize?.name || `${layerNumber}等賞`;
        const prizeId = matchingPrize?.prize_id || null;
        const prizeImageUrl = matchingPrize?.image_url || null;

        // Create lottery result
        const resultId = generateUUID();

        await client.query(
          `INSERT INTO lottery_results (
            result_id, campaign_id, position_id, user_id, prize_id, prize_rank, drawn_at, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
          [
            resultId,
            campaignId,
            winningPosition.position_id,
            winningPosition.user_id,
            prizeId,
            layerNumber,
          ]
        );

        // Update user prizes_won count
        // 目的: 当選者のprizes_wonカウントを増加
        // 注意点: positions.user_id と users.user_id の型一致が必要（両方UUID）
        const updateResult = await client.query(
          'UPDATE users SET prizes_won = prizes_won + 1, updated_at = NOW() WHERE user_id = $1',
          [winningPosition.user_id]
        );

        // 更新行数をログ出力（デバッグ用）
        if (updateResult.rowCount === 0) {
          logger.warn('Failed to update prizes_won - user not found', {
            positionUserId: winningPosition.user_id,
            campaignId,
            layerNumber,
          });
        } else {
          logger.info('Updated prizes_won for winner', {
            userId: winningPosition.user_id,
            rowsUpdated: updateResult.rowCount,
          });
        }

        // Get user info for winner list
        interface UserInfo {
          user_id: string;
          email: string;
          display_name: string;
        }

        const { rows: userRows } = await client.query<UserInfo>(
          'SELECT user_id, email, display_name FROM users WHERE user_id = $1',
          [winningPosition.user_id]
        );

        if (userRows.length > 0) {
          winners.push({
            user_id: userRows[0].user_id,
            user_email: userRows[0].email,
            user_display_name: userRows[0].display_name,
            position_row: winningPosition.row_number,
            position_col: winningPosition.col_number,
            position_layer: winningPosition.layer_number,
            prize_id: prizeId || resultId, // 如果没有 prize_id，使用 result_id
            prize_name: prizeName,
            prize_rank: layerNumber,
            prize_image_url: prizeImageUrl,
            drawn_at: new Date(),
          });
        }

        logger.info(`Winner selected for layer ${layerNumber}`, {
          campaignId,
          userId: winningPosition.user_id,
          layerNumber,
          prizeName,
          prizeValue,
        });
      }

      // Update campaign status to drawn
      await client.query(
        `UPDATE campaigns
         SET status = 'drawn', drawn_at = NOW(), updated_at = NOW()
         WHERE campaign_id = $1`,
        [campaignId]
      );

      await client.query('COMMIT');

      logger.info(`Lottery draw completed for campaign ${campaignId}`, {
        winnersCount: winners.length,
      });

      // Send notifications to winners asynchronously (don't await)
      this.notifyWinners(campaignId, winners).catch((err: unknown) => {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        logger.error('Failed to notify winners', { error: errorMessage, campaignId });
      });

      return {
        campaign_id: campaignId,
        campaign_name: campaign.name,
        total_positions: campaign.positions_total,
        sold_positions: soldPositionsCount,
        total_prizes: campaign.prizes.reduce((sum, p) => sum + p.quantity, 0),
        winners_count: winners.length,
        drawn_at: new Date(),
        winners,
      };
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to draw lottery', {
        error: errorMessage,
        campaignId,
      });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get lottery results for a campaign
   */
  async getCampaignResults(campaignId: string): Promise<Winner[]> {
    try {
      interface WinnerRow {
        user_id: string;
        user_email: string;
        user_display_name: string;
        position_id: string;
        position_row: number;
        position_col: number;
        position_layer: number;
        prize_id: string;
        prize_name: string;
        prize_rank: number;
        prize_value: number;
        prize_image_url: string | null;
        drawn_at: Date;
      }

      const { rows } = await pool.query<WinnerRow>(
        `SELECT
          u.user_id,
          u.email as user_email,
          u.display_name as user_display_name,
          pos.position_id,
          pos.row_number as position_row,
          pos.col_number as position_col,
          pos.layer_number as position_layer,
          pr.prize_id,
          pr.name as prize_name,
          pr.rank as prize_rank,
          pr.value as prize_value,
          pr.image_url as prize_image_url,
          lr.drawn_at
         FROM lottery_results lr
         JOIN users u ON lr.user_id = u.user_id
         JOIN positions pos ON lr.position_id = pos.position_id
         JOIN prizes pr ON lr.prize_id = pr.prize_id
         WHERE lr.campaign_id = $1
         ORDER BY pr.rank ASC, lr.drawn_at ASC`,
        [campaignId]
      );

      return rows.map((row) => ({
        user_id: row.user_id,
        user_email: row.user_email,
        user_display_name: row.user_display_name,
        position_id: row.position_id,
        position_row: row.position_row,
        position_col: row.position_col,
        position_layer: row.position_layer,
        prize_id: row.prize_id,
        prize_name: row.prize_name,
        prize_rank: row.prize_rank,
        prize_value: row.prize_value,
        prize_image_url: row.prize_image_url,
        drawn_at: new Date(row.drawn_at),
      }));
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to get campaign results', {
        error: errorMessage,
        campaignId,
      });
      throw error;
    }
  }

  /**
   * Get user's lottery results across all campaigns
   */
  async getUserResults(userId: string): Promise<LotteryResult[]> {
    try {
      const { rows } = await pool.query<LotteryResult>(
        `SELECT * FROM lottery_results
         WHERE user_id = $1
         ORDER BY drawn_at DESC`,
        [userId]
      );

      return rows.map(mapRowToLotteryResult);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to get user results', {
        error: errorMessage,
        userId,
      });
      throw error;
    }
  }

  /**
   * Check if user won in a campaign
   */
  async checkUserWin(userId: string, campaignId: string): Promise<Winner | null> {
    try {
      interface WinnerRow {
        user_id: string;
        user_email: string;
        user_display_name: string;
        position_id: string;
        position_row: number;
        position_col: number;
        position_layer: number;
        prize_id: string;
        prize_name: string;
        prize_rank: number;
        prize_value: number;
        prize_image_url: string | null;
        drawn_at: Date;
      }

      const { rows } = await pool.query<WinnerRow>(
        `SELECT
          u.user_id,
          u.email as user_email,
          u.display_name as user_display_name,
          pos.position_id,
          pos.row_number as position_row,
          pos.col_number as position_col,
          pos.layer_number as position_layer,
          pr.prize_id,
          pr.name as prize_name,
          pr.rank as prize_rank,
          pr.value as prize_value,
          pr.image_url as prize_image_url,
          lr.drawn_at
         FROM lottery_results lr
         JOIN users u ON lr.user_id = u.user_id
         JOIN positions pos ON lr.position_id = pos.position_id
         JOIN prizes pr ON lr.prize_id = pr.prize_id
         WHERE lr.user_id = $1 AND lr.campaign_id = $2
         LIMIT 1`,
        [userId, campaignId]
      );

      if (rows.length === 0) {
        return null;
      }

      const row = rows[0];
      return {
        user_id: row.user_id,
        user_email: row.user_email,
        user_display_name: row.user_display_name,
        position_id: row.position_id,
        position_row: row.position_row,
        position_col: row.position_col,
        position_layer: row.position_layer,
        prize_id: row.prize_id,
        prize_name: row.prize_name,
        prize_rank: row.prize_rank,
        prize_value: row.prize_value,
        prize_image_url: row.prize_image_url,
        drawn_at: new Date(row.drawn_at),
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to check user win', {
        error: errorMessage,
        userId,
        campaignId,
      });
      throw error;
    }
  }

  /**
   * 当選者に通知を送信
   * 目的: 抽選結果を当選者に通知
   * I/O: campaignId, winnersを受け取り、各当選者にプッシュ通知を送信
   * 注意点: FCMトークンがない場合やエラー発生時も他の当選者への送信を継続
   */
  private async notifyWinners(campaignId: string, winners: Winner[]): Promise<void> {
    try {
      const campaign = await campaignService.getCampaignById(campaignId);

      if (!campaign) {
        return;
      }

      for (const winner of winners) {
        await notificationService.sendToUser(
          winner.user_id,
          NotificationType.PRIZE_WON,
          {
            title: '🎉 おめでとうございます！当選しました！',
            body: `「${campaign.name}」で「${winner.prize_name}」に当選しました！`,
            data: {
              campaign_id: campaignId,
              prize_id: winner.prize_id,
              prize_rank: winner.prize_rank.toString(),
            },
          }
        );
      }

      logger.info('当選者への通知を送信しました', {
        campaignId,
        winnersCount: winners.length,
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('当選者への通知送信に失敗しました', {
        error: errorMessage,
        campaignId,
      });
    }
  }

  /**
   * Convert campaign ID to lock ID for PostgreSQL advisory lock
   */
  private campaignIdToLockId(campaignId: string): number {
    // Use first 8 characters of UUID and convert to number
    const hashCode = campaignId
      .substring(0, 8)
      .split('')
      .reduce((hash, char) => {
        return char.charCodeAt(0) + ((hash << 5) - hash);
      }, 0);

    // Return positive integer
    return Math.abs(hashCode);
  }
}

export default new LotteryService();
