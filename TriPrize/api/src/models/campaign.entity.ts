import { QueryResultRow } from 'pg';

/**
 * Campaign entity representing a lottery campaign
 */
export interface Campaign {
  campaign_id: string;
  name: string;
  description: string | null;
  base_length: number;
  positions_total: number;
  positions_sold: number;
  layer_prices: Record<string, number>;
  profit_margin_percent: number;
  purchase_limit: number | null;
  start_date: Date | null;
  end_date: Date | null;
  status: CampaignStatus;
  created_at: Date;
  updated_at: Date;
  drawn_at: Date | null;
}

/**
 * Campaign status
 */
export enum CampaignStatus {
  DRAFT = 'draft',
  PUBLISHED = 'published',
  CLOSED = 'closed',
  DRAWN = 'drawn',
}

/**
 * Layer information
 */
export interface Layer {
  layer_id: string;
  campaign_id: string;
  layer_number: number;
  positions_count: number;
  positions_sold: number;
  price: number;
  created_at: Date;
  updated_at: Date;
}

/**
 * Position information
 */
export interface Position {
  position_id: string;
  campaign_id: string;
  layer_number: number;
  row_number: number;
  col_number: number;
  price: number;
  status: PositionStatus;
  user_id: string | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Position status
 */
export enum PositionStatus {
  AVAILABLE = 'available',
  RESERVED = 'reserved',
  SOLD = 'sold',
}

/**
 * Prize information
 */
export interface Prize {
  prize_id: string;
  campaign_id: string;
  name: string;
  description: string | null;
  rank: number;
  quantity: number;
  value: number;
  image_url: string | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Create campaign DTO
 */
export interface CreateCampaignDto {
  name: string;
  description?: string;
  base_length: number;
  layer_prices: Record<string, number>;
  profit_margin_percent: number;
  purchase_limit?: number;
  start_date?: Date;
  end_date?: Date;
  prizes: CreatePrizeDto[];
}

/**
 * Create prize DTO
 */
export interface CreatePrizeDto {
  name: string;
  description?: string;
  rank: number;
  quantity: number;
  value: number;
  image_url?: string;
}

/**
 * Update campaign DTO
 */
export interface UpdateCampaignDto {
  name?: string;
  description?: string;
  layer_prices?: Record<string, number>;
  profit_margin_percent?: number;
  purchase_limit?: number;
  start_date?: Date;
  end_date?: Date;
  status?: CampaignStatus;
}

/**
 * Campaign list item (summary view)
 */
export interface CampaignListItem {
  campaign_id: string;
  name: string;
  description: string | null;
  base_length: number;
  positions_total: number;
  positions_sold: number;
  progress_percent: number;
  min_price: number;
  max_price: number;
  status: CampaignStatus;
  end_date: Date | null;
  created_at: Date;
}

/**
 * Campaign detail with layers and prizes
 */
export interface CampaignDetail extends Campaign {
  layers: Layer[];
  prizes: Prize[];
}

/**
 * Map database row to Campaign entity
 */
export function mapRowToCampaign(row: QueryResultRow): Campaign {
  return {
    campaign_id: String(row.campaign_id),
    name: String(row.name),
    description: row.description ? String(row.description) : null,
    base_length: Number.parseInt(String(row.base_length), 10),
    positions_total: Number.parseInt(String(row.positions_total), 10),
    positions_sold: Number.parseInt(String(row.positions_sold), 10),
    layer_prices: row.layer_prices as Record<string, number>,
    profit_margin_percent: Number.parseFloat(String(row.profit_margin_percent)),
    purchase_limit: row.purchase_limit ? Number.parseInt(String(row.purchase_limit), 10) : null,
    start_date: row.start_date ? new Date(row.start_date as string | number | Date) : null,
    end_date: row.end_date ? new Date(row.end_date as string | number | Date) : null,
    status: row.status as CampaignStatus,
    created_at: new Date(row.created_at as string | number | Date),
    updated_at: new Date(row.updated_at as string | number | Date),
    drawn_at: row.drawn_at ? new Date(row.drawn_at as string | number | Date) : null,
  };
}

/**
 * Map database row to Layer entity
 */
export function mapRowToLayer(row: QueryResultRow): Layer {
  return {
    layer_id: String(row.layer_id),
    campaign_id: String(row.campaign_id),
    layer_number: Number.parseInt(String(row.layer_number), 10),
    positions_count: Number.parseInt(String(row.positions_count), 10),
    positions_sold: Number.parseInt(String(row.positions_sold), 10),
    price: Number.parseInt(String(row.price), 10),
    created_at: new Date(row.created_at as string | number | Date),
    updated_at: new Date(row.updated_at as string | number | Date),
  };
}

/**
 * Map database row to Position entity
 */
export function mapRowToPosition(row: QueryResultRow): Position {
  return {
    position_id: String(row.position_id),
    campaign_id: String(row.campaign_id),
    layer_number: Number.parseInt(String(row.layer_number), 10),
    row_number: Number.parseInt(String(row.row_number), 10),
    col_number: Number.parseInt(String(row.col_number), 10),
    price: Number.parseInt(String(row.price), 10),
    status: row.status as PositionStatus,
    user_id: row.user_id ? String(row.user_id) : null,
    created_at: new Date(row.created_at as string | number | Date),
    updated_at: new Date(row.updated_at as string | number | Date),
  };
}

/**
 * Map database row to Prize entity
 */
export function mapRowToPrize(row: QueryResultRow): Prize {
  return {
    prize_id: String(row.prize_id),
    campaign_id: String(row.campaign_id),
    name: String(row.name),
    description: row.description ? String(row.description) : null,
    rank: Number.parseInt(String(row.rank), 10),
    quantity: Number.parseInt(String(row.quantity), 10),
    value: Number.parseInt(String(row.value), 10),
    image_url: row.image_url ? String(row.image_url) : null,
    created_at: new Date(row.created_at as string | number | Date),
    updated_at: new Date(row.updated_at as string | number | Date),
  };
}

export default {
  CampaignStatus,
  PositionStatus,
  mapRowToCampaign,
  mapRowToLayer,
  mapRowToPosition,
  mapRowToPrize,
};
