// Common type definitions for ForgePayBridge

export type ProductType = 'one_time' | 'subscription';

export type EntitlementStatus = 'active' | 'suspended' | 'expired' | 'revoked';

export type WebhookEventStatus = 'pending' | 'processed' | 'failed' | 'dlq';

export type CheckoutSessionStatus = 'open' | 'complete' | 'expired';

export type SubscriptionInterval = 'month' | 'year';

export type Currency = 'usd' | 'eur' | 'gbp' | 'jpy' | 'aud' | 'cad';

export type TaxType = 'VAT' | 'GST' | 'SALES_TAX' | 'NONE';

export interface Address {
  country: string;
  state?: string;
  postalCode?: string;
  city?: string;
  line1?: string;
  line2?: string;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    totalPages: number;
    totalItems: number;
  };
}

export interface AuditLogEntry {
  id: string;
  developerId?: string;
  userId?: string;
  action: string;
  resourceType: string;
  resourceId: string;
  changes?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  createdAt: Date;
}
