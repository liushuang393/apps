import { QueryResultRow } from 'pg';

/**
 * Purchase entity representing a position purchase
 */
export interface Purchase {
  purchase_id: string;
  user_id: string;
  campaign_id: string;
  position_id: string;
  quantity: number;
  price_per_position: number;
  total_amount: number;
  status: PurchaseStatus;
  payment_intent_id: string | null;
  idempotency_key: string | null;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
}

/**
 * Purchase status
 */
export enum PurchaseStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  REFUNDED = 'refunded',
}

/**
 * Create purchase DTO
 * 目的: 抽選チケット購入リクエストのデータ転送オブジェクト
 * 注意点:
 *   - quantity: 購入数量（1-10、デフォルト1）
 *   - position_ids: 後方互換性のため残すが、quantityを優先
 *   - idempotency_key: クライアントから受け取る冪等性キー
 */
export interface CreatePurchaseDto {
  campaign_id: string;
  quantity?: number;
  position_ids?: string[];
  payment_method?: 'card' | 'konbini';
  idempotency_key?: string;
}

/**
 * Purchase detail with position and campaign info
 */
export interface PurchaseDetail extends Purchase {
  campaign_name: string;
  position_row: number;
  position_col: number;
  position_layer: number;
}

/**
 * Map database row to Purchase entity
 */
export function mapRowToPurchase(row: QueryResultRow): Purchase {
  return {
    purchase_id: String(row.purchase_id),
    user_id: String(row.user_id),
    campaign_id: String(row.campaign_id),
    position_id: String(row.position_id),
    quantity: Number.parseInt(String(row.quantity), 10),
    price_per_position: Number.parseInt(String(row.price_per_position), 10),
    total_amount: Number.parseInt(String(row.total_amount), 10),
    status: row.status as PurchaseStatus,
    payment_intent_id: row.payment_intent_id ? String(row.payment_intent_id) : null,
    idempotency_key: row.idempotency_key ? String(row.idempotency_key) : null,
    created_at: new Date(row.created_at as string | number | Date),
    updated_at: new Date(row.updated_at as string | number | Date),
    completed_at: row.completed_at ? new Date(row.completed_at as string | number | Date) : null,
  };
}

export default {
  PurchaseStatus,
  mapRowToPurchase,
};
