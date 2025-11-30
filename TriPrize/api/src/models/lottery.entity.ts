import { QueryResultRow } from 'pg';

/**
 * Lottery draw result entity
 */
export interface LotteryResult {
  result_id: string;
  campaign_id: string;
  position_id: string;
  user_id: string;
  prize_id: string;
  prize_rank: number;
  drawn_at: Date;
  notified_at: Date | null;
  claimed_at: Date | null;
  created_at: Date;
}

/**
 * Winner information
 */
export interface Winner {
  user_id: string;
  user_email: string;
  user_display_name: string | null;
  position_row: number;
  position_col: number;
  position_layer: number;
  prize_id: string;
  prize_name: string;
  prize_rank: number;
  prize_image_url: string | null;
  drawn_at: Date;
}

/**
 * Lottery draw summary
 */
export interface LotteryDrawSummary {
  campaign_id: string;
  campaign_name: string;
  total_positions: number;
  sold_positions: number;
  total_prizes: number;
  winners_count: number;
  drawn_at: Date;
  winners: Winner[];
}

/**
 * Map database row to LotteryResult entity
 */
export function mapRowToLotteryResult(row: QueryResultRow): LotteryResult {
  return {
    result_id: String(row.result_id),
    campaign_id: String(row.campaign_id),
    position_id: String(row.position_id),
    user_id: String(row.user_id),
    prize_id: String(row.prize_id),
    prize_rank: Number.parseInt(String(row.prize_rank), 10),
    drawn_at: new Date(row.drawn_at as string | number | Date),
    notified_at: row.notified_at ? new Date(row.notified_at as string | number | Date) : null,
    claimed_at: row.claimed_at ? new Date(row.claimed_at as string | number | Date) : null,
    created_at: new Date(row.created_at as string | number | Date),
  };
}

export default {
  mapRowToLotteryResult,
};
