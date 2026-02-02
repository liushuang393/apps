import { Pool, PoolClient } from 'pg';
import { pool } from '../config/database';
import { logger } from '../utils/logger';

/**
 * Invoice status
 */
export type InvoiceStatus = 'draft' | 'issued' | 'paid' | 'void' | 'refunded';

/**
 * Invoice line item
 */
export interface InvoiceLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  productId?: string;
  priceId?: string;
}

/**
 * Invoice entity
 */
export interface Invoice {
  id: string;
  invoiceNumber: string;
  developerId: string;
  customerId: string;
  stripeInvoiceId: string | null;
  stripePaymentIntentId: string | null;
  status: InvoiceStatus;
  currency: string;
  subtotal: number;
  taxAmount: number;
  total: number;
  lineItems: InvoiceLineItem[];
  billingAddress: Record<string, unknown> | null;
  taxDetails: Record<string, unknown> | null;
  pdfUrl: string | null;
  pdfGeneratedAt: Date | null;
  issuedAt: Date | null;
  paidAt: Date | null;
  dueDate: Date | null;
  notes: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Parameters for creating an invoice
 */
export interface CreateInvoiceParams {
  developerId: string;
  customerId: string;
  stripeInvoiceId?: string;
  stripePaymentIntentId?: string;
  currency: string;
  subtotal: number;
  taxAmount?: number;
  total: number;
  lineItems: InvoiceLineItem[];
  billingAddress?: Record<string, unknown>;
  taxDetails?: Record<string, unknown>;
  dueDate?: Date;
  notes?: string;
  metadata?: Record<string, unknown>;
}

/**
 * InvoiceRepository handles all database operations for invoices
 */
export class InvoiceRepository {
  private pool: Pool;

  constructor(dbPool: Pool = pool) {
    this.pool = dbPool;
  }

  /**
   * Generate unique invoice number
   */
  private async generateInvoiceNumber(client: Pool | PoolClient): Promise<string> {
    const result = await client.query(`SELECT nextval('invoice_number_seq') as seq`);
    const seq = result.rows[0].seq;
    const year = new Date().getFullYear();
    return `INV-${year}-${String(seq).padStart(6, '0')}`;
  }

  /**
   * Create a new invoice
   */
  async create(
    params: CreateInvoiceParams,
    client?: PoolClient
  ): Promise<Invoice> {
    const dbClient = client || this.pool;
    const invoiceNumber = await this.generateInvoiceNumber(dbClient);

    const query = `
      INSERT INTO invoices (
        invoice_number, developer_id, customer_id, stripe_invoice_id,
        stripe_payment_intent_id, currency, subtotal, tax_amount, total,
        line_items, billing_address, tax_details, due_date, notes, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING *
    `;

    const values = [
      invoiceNumber,
      params.developerId,
      params.customerId,
      params.stripeInvoiceId || null,
      params.stripePaymentIntentId || null,
      params.currency,
      params.subtotal,
      params.taxAmount || 0,
      params.total,
      JSON.stringify(params.lineItems),
      params.billingAddress ? JSON.stringify(params.billingAddress) : null,
      params.taxDetails ? JSON.stringify(params.taxDetails) : null,
      params.dueDate || null,
      params.notes || null,
      params.metadata ? JSON.stringify(params.metadata) : null,
    ];

    try {
      const result = await dbClient.query(query, values);
      const invoice = this.mapRowToInvoice(result.rows[0]);

      logger.info('Invoice created', {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
      });

      return invoice;
    } catch (error) {
      logger.error('Error creating invoice', { error });
      throw error;
    }
  }

  /**
   * Find invoice by ID
   */
  async findById(id: string, client?: PoolClient): Promise<Invoice | null> {
    const dbClient = client || this.pool;

    const query = `SELECT * FROM invoices WHERE id = $1`;

    try {
      const result = await dbClient.query(query, [id]);
      if (result.rows.length === 0) {
        return null;
      }
      return this.mapRowToInvoice(result.rows[0]);
    } catch (error) {
      logger.error('Error finding invoice', { error, id });
      throw error;
    }
  }

  /**
   * Find invoice by invoice number
   */
  async findByInvoiceNumber(invoiceNumber: string, client?: PoolClient): Promise<Invoice | null> {
    const dbClient = client || this.pool;

    const query = `SELECT * FROM invoices WHERE invoice_number = $1`;

    try {
      const result = await dbClient.query(query, [invoiceNumber]);
      if (result.rows.length === 0) {
        return null;
      }
      return this.mapRowToInvoice(result.rows[0]);
    } catch (error) {
      logger.error('Error finding invoice by number', { error, invoiceNumber });
      throw error;
    }
  }

  /**
   * Find invoices by customer
   */
  async findByCustomerId(
    customerId: string,
    options?: { limit?: number; offset?: number; status?: InvoiceStatus },
    client?: PoolClient
  ): Promise<Invoice[]> {
    const dbClient = client || this.pool;
    const limit = options?.limit || 50;
    const offset = options?.offset || 0;

    let query = `SELECT * FROM invoices WHERE customer_id = $1`;
    const values: unknown[] = [customerId];
    let paramIndex = 2;

    if (options?.status) {
      query += ` AND status = $${paramIndex++}`;
      values.push(options.status);
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
    values.push(limit, offset);

    try {
      const result = await dbClient.query(query, values);
      return result.rows.map((row) => this.mapRowToInvoice(row));
    } catch (error) {
      logger.error('Error finding invoices by customer', { error, customerId });
      throw error;
    }
  }

  /**
   * Find invoices by developer
   */
  async findByDeveloperId(
    developerId: string,
    options?: { limit?: number; offset?: number; status?: InvoiceStatus },
    client?: PoolClient
  ): Promise<{ invoices: Invoice[]; total: number }> {
    const dbClient = client || this.pool;
    const limit = options?.limit || 50;
    const offset = options?.offset || 0;

    let query = `SELECT * FROM invoices WHERE developer_id = $1`;
    let countQuery = `SELECT COUNT(*) as total FROM invoices WHERE developer_id = $1`;
    const values: unknown[] = [developerId];
    let paramIndex = 2;

    if (options?.status) {
      query += ` AND status = $${paramIndex}`;
      countQuery += ` AND status = $${paramIndex}`;
      values.push(options.status);
      paramIndex++;
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
    values.push(limit, offset);

    try {
      const [result, countResult] = await Promise.all([
        dbClient.query(query, values),
        dbClient.query(countQuery, values.slice(0, -2)),
      ]);

      return {
        invoices: result.rows.map((row) => this.mapRowToInvoice(row)),
        total: parseInt(countResult.rows[0].total, 10),
      };
    } catch (error) {
      logger.error('Error finding invoices by developer', { error, developerId });
      throw error;
    }
  }

  /**
   * Update invoice status
   */
  async updateStatus(
    id: string,
    status: InvoiceStatus,
    client?: PoolClient
  ): Promise<Invoice | null> {
    const dbClient = client || this.pool;

    const updates: string[] = [`status = $1`, `updated_at = NOW()`];
    const values: unknown[] = [status];

    if (status === 'issued') {
      updates.push(`issued_at = NOW()`);
    } else if (status === 'paid') {
      updates.push(`paid_at = NOW()`);
    }

    const query = `
      UPDATE invoices
      SET ${updates.join(', ')}
      WHERE id = $${values.length + 1}
      RETURNING *
    `;
    values.push(id);

    try {
      const result = await dbClient.query(query, values);
      if (result.rows.length === 0) {
        return null;
      }
      return this.mapRowToInvoice(result.rows[0]);
    } catch (error) {
      logger.error('Error updating invoice status', { error, id, status });
      throw error;
    }
  }

  /**
   * Update PDF URL
   */
  async updatePdfUrl(
    id: string,
    pdfUrl: string,
    client?: PoolClient
  ): Promise<Invoice | null> {
    const dbClient = client || this.pool;

    const query = `
      UPDATE invoices
      SET pdf_url = $1, pdf_generated_at = NOW(), updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `;

    try {
      const result = await dbClient.query(query, [pdfUrl, id]);
      if (result.rows.length === 0) {
        return null;
      }
      return this.mapRowToInvoice(result.rows[0]);
    } catch (error) {
      logger.error('Error updating invoice PDF URL', { error, id });
      throw error;
    }
  }

  /**
   * Map database row to Invoice entity
   */
  private mapRowToInvoice(row: Record<string, unknown>): Invoice {
    return {
      id: row.id as string,
      invoiceNumber: row.invoice_number as string,
      developerId: row.developer_id as string,
      customerId: row.customer_id as string,
      stripeInvoiceId: row.stripe_invoice_id as string | null,
      stripePaymentIntentId: row.stripe_payment_intent_id as string | null,
      status: row.status as InvoiceStatus,
      currency: row.currency as string,
      subtotal: row.subtotal as number,
      taxAmount: row.tax_amount as number,
      total: row.total as number,
      lineItems: row.line_items as InvoiceLineItem[],
      billingAddress: row.billing_address as Record<string, unknown> | null,
      taxDetails: row.tax_details as Record<string, unknown> | null,
      pdfUrl: row.pdf_url as string | null,
      pdfGeneratedAt: row.pdf_generated_at ? new Date(row.pdf_generated_at as string) : null,
      issuedAt: row.issued_at ? new Date(row.issued_at as string) : null,
      paidAt: row.paid_at ? new Date(row.paid_at as string) : null,
      dueDate: row.due_date ? new Date(row.due_date as string) : null,
      notes: row.notes as string | null,
      metadata: row.metadata as Record<string, unknown> | null,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }
}

// Export singleton instance
export const invoiceRepository = new InvoiceRepository();
