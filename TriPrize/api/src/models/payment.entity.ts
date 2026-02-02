import { QueryResultRow } from 'pg';

/**
 * Payment transaction entity
 */
export interface PaymentTransaction {
  transaction_id: string;
  purchase_id: string;
  user_id: string;
  amount: number;
  currency: string;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  stripe_payment_intent_id: string | null;
  stripe_charge_id: string | null;
  konbini_code: string | null;
  konbini_store_type: string | null;
  konbini_expires_at: Date | null;
  error_message: string | null;
  metadata: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
  paid_at: Date | null;
}

/**
 * Payment method types
 */
export enum PaymentMethod {
  CARD = 'card',
  KONBINI = 'konbini',
}

/**
 * Payment status
 */
export enum PaymentStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  REQUIRES_ACTION = 'requires_action',
  SUCCEEDED = 'succeeded',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  REFUNDED = 'refunded',
}

/**
 * Create payment intent DTO
 */
export interface CreatePaymentIntentDto {
  purchase_id: string;
  payment_method: PaymentMethod;
  return_url?: string; // For 3D Secure redirects
}

/**
 * Konbini payment information
 */
export interface KonbiniPaymentInfo {
  store_type: string; // lawson, familymart, seveneleven, etc.
  confirmation_number: string;
  payment_code: string;
  expires_at: Date;
  instructions_url: string;
}

/**
 * Map database row to PaymentTransaction entity
 */
export function mapRowToPaymentTransaction(row: QueryResultRow): PaymentTransaction {
  return {
    transaction_id: String(row.transaction_id),
    purchase_id: String(row.purchase_id),
    user_id: String(row.user_id),
    amount: Number.parseInt(String(row.amount), 10),
    currency: String(row.currency),
    payment_method: row.payment_method as PaymentMethod,
    payment_status: row.payment_status as PaymentStatus,
    stripe_payment_intent_id: row.stripe_payment_intent_id ? String(row.stripe_payment_intent_id) : null,
    stripe_charge_id: row.stripe_charge_id ? String(row.stripe_charge_id) : null,
    konbini_code: row.konbini_code ? String(row.konbini_code) : null,
    konbini_store_type: row.konbini_store_type ? String(row.konbini_store_type) : null,
    konbini_expires_at: row.konbini_expires_at ? new Date(row.konbini_expires_at as string | number | Date) : null,
    error_message: row.error_message ? String(row.error_message) : null,
    metadata: row.metadata as Record<string, unknown> | null,
    created_at: new Date(row.created_at as string | number | Date),
    updated_at: new Date(row.updated_at as string | number | Date),
    paid_at: row.paid_at ? new Date(row.paid_at as string | number | Date) : null,
  };
}

export default {
  PaymentMethod,
  PaymentStatus,
  mapRowToPaymentTransaction,
};
