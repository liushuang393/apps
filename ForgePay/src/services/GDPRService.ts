import { Pool } from 'pg';
import { pool } from '../config/database';
import { CustomerRepository, customerRepository } from '../repositories/CustomerRepository';
import { EntitlementRepository, entitlementRepository } from '../repositories/EntitlementRepository';
import { AuditLogRepository, auditLogRepository } from '../repositories/AuditLogRepository';
import { EmailService, emailService } from './EmailService';
import { logger } from '../utils/logger';

/**
 * GDPR request type
 */
export type GDPRRequestType = 'data_export' | 'data_deletion' | 'data_rectification';

/**
 * GDPR request status
 */
export type GDPRRequestStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

/**
 * GDPR request entity
 */
export interface GDPRRequest {
  id: string;
  developerId: string;
  customerId: string | null;
  customerEmail: string;
  requestType: GDPRRequestType;
  status: GDPRRequestStatus;
  requestedBy: string;
  reason: string | null;
  dataCategories: string[] | null;
  exportFileUrl: string | null;
  exportFileExpiresAt: Date | null;
  processedAt: Date | null;
  completedAt: Date | null;
  errorMessage: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Customer data export
 */
export interface CustomerDataExport {
  customer: {
    id: string;
    email: string;
    name: string | null;
    stripeCustomerId: string | null;
    createdAt: Date;
  };
  entitlements: {
    id: string;
    productName: string;
    type: string;
    status: string;
    createdAt: Date;
    expiresAt: Date | null;
  }[];
  invoices: {
    invoiceNumber: string;
    amount: number;
    currency: string;
    status: string;
    createdAt: Date;
  }[];
  legalAcceptances: {
    templateType: string;
    templateVersion: number;
    acceptedAt: Date;
  }[];
  auditLogs: {
    action: string;
    timestamp: Date;
  }[];
  exportedAt: Date;
}

/**
 * GDPRService handles GDPR compliance operations
 * 
 * Requirements: 13.1, 13.2, 13.3, 13.4
 */
export class GDPRService {
  private pool: Pool;
  private customerRepo: CustomerRepository;
  private entitlementRepo: EntitlementRepository;
  private auditRepo: AuditLogRepository;
  private emailSvc: EmailService;

  constructor(
    dbPool: Pool = pool,
    customerRepo: CustomerRepository = customerRepository,
    entitlementRepo: EntitlementRepository = entitlementRepository,
    auditRepo: AuditLogRepository = auditLogRepository,
    emailSvc: EmailService = emailService
  ) {
    this.pool = dbPool;
    this.customerRepo = customerRepo;
    this.entitlementRepo = entitlementRepo;
    this.auditRepo = auditRepo;
    this.emailSvc = emailSvc;
  }

  /**
   * Create a GDPR request
   */
  async createRequest(params: {
    developerId: string;
    customerEmail: string;
    requestType: GDPRRequestType;
    requestedBy: string;
    reason?: string;
    dataCategories?: string[];
  }): Promise<GDPRRequest> {
    // Find customer
    const customer = await this.customerRepo.findByEmail(params.customerEmail);

    const query = `
      INSERT INTO gdpr_requests (
        developer_id, customer_id, customer_email, request_type,
        requested_by, reason, data_categories
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;

    const values = [
      params.developerId,
      customer?.id || null,
      params.customerEmail,
      params.requestType,
      params.requestedBy,
      params.reason || null,
      params.dataCategories || null,
    ];

    try {
      const result = await this.pool.query(query, values);
      const request = this.mapRowToRequest(result.rows[0]);

      // Log the request
      await this.auditRepo.create({
        developerId: params.developerId,
        action: 'gdpr.request_created',
        resourceType: 'gdpr_request',
        resourceId: request.id,
        changes: {
          requestType: params.requestType,
          customerEmail: params.customerEmail,
        },
      });

      logger.info('GDPR request created', {
        requestId: request.id,
        type: params.requestType,
      });

      return request;
    } catch (error) {
      logger.error('Error creating GDPR request', { error });
      throw error;
    }
  }

  /**
   * Process a GDPR request
   */
  async processRequest(requestId: string): Promise<GDPRRequest> {
    const request = await this.getRequest(requestId);
    if (!request) {
      throw new Error('GDPR request not found');
    }

    // Update status to processing
    await this.updateRequestStatus(requestId, 'processing');

    try {
      switch (request.requestType) {
        case 'data_export':
          await this.processDataExport(request);
          break;
        case 'data_deletion':
          await this.processDataDeletion(request);
          break;
        case 'data_rectification':
          // Rectification would require specific fields to update
          throw new Error('Data rectification requires manual handling');
        default:
          throw new Error(`Unknown request type: ${request.requestType}`);
      }

      // Update status to completed
      return await this.updateRequestStatus(requestId, 'completed');
    } catch (error) {
      logger.error('Error processing GDPR request', { error, requestId });
      await this.updateRequestStatus(requestId, 'failed', String(error));
      throw error;
    }
  }

  /**
   * Export customer data
   */
  async exportCustomerData(
    _developerId: string,
    customerEmail: string
  ): Promise<CustomerDataExport> {
    const customer = await this.customerRepo.findByEmail(customerEmail);
    if (!customer) {
      throw new Error('Customer not found');
    }

    // Gather all customer data
    const entitlements = await this.entitlementRepo.findByCustomerId(customer.id);

    // Get invoices
    const invoicesResult = await this.pool.query(
      `SELECT invoice_number, total as amount, currency, status, created_at 
       FROM invoices WHERE customer_id = $1`,
      [customer.id]
    );

    // Get legal acceptances
    const acceptancesResult = await this.pool.query(
      `SELECT template_type, template_version, accepted_at 
       FROM customer_legal_acceptances WHERE customer_id = $1`,
      [customer.id]
    );

    // Get audit logs related to customer
    const auditLogsResult = await this.pool.query(
      `SELECT action, created_at as timestamp 
       FROM audit_logs WHERE resource_id = $1 
       ORDER BY created_at DESC LIMIT 100`,
      [customer.id]
    );

    const exportData: CustomerDataExport = {
      customer: {
        id: customer.id,
        email: customer.email,
        name: customer.name,
        stripeCustomerId: customer.stripeCustomerId,
        createdAt: customer.createdAt,
      },
      entitlements: entitlements.map((e) => ({
        id: e.id,
        productName: e.productId, // Would need to join with products
        type: e.subscriptionId ? 'subscription' : 'one_time',
        status: e.status,
        createdAt: e.createdAt,
        expiresAt: e.expiresAt,
      })),
      invoices: invoicesResult.rows.map((row) => ({
        invoiceNumber: row.invoice_number,
        amount: row.amount,
        currency: row.currency,
        status: row.status,
        createdAt: new Date(row.created_at),
      })),
      legalAcceptances: acceptancesResult.rows.map((row) => ({
        templateType: row.template_type,
        templateVersion: row.template_version,
        acceptedAt: new Date(row.accepted_at),
      })),
      auditLogs: auditLogsResult.rows.map((row) => ({
        action: row.action,
        timestamp: new Date(row.timestamp),
      })),
      exportedAt: new Date(),
    };

    logger.info('Customer data exported', {
      customerId: customer.id,
      email: customerEmail,
    });

    return exportData;
  }

  /**
   * Delete customer data
   */
  async deleteCustomerData(
    developerId: string,
    customerEmail: string,
    options?: { keepTransactionRecords?: boolean }
  ): Promise<{ deletedRecords: number; anonymizedRecords: number }> {
    const customer = await this.customerRepo.findByEmail(customerEmail);
    if (!customer) {
      throw new Error('Customer not found');
    }

    const client = await this.pool.connect();
    let deletedRecords = 0;
    let anonymizedRecords = 0;

    try {
      await client.query('BEGIN');

      // Delete entitlements
      const entitlementResult = await client.query(
        `DELETE FROM entitlements WHERE customer_id = $1`,
        [customer.id]
      );
      deletedRecords += entitlementResult.rowCount || 0;

      // Delete legal acceptances
      const acceptanceResult = await client.query(
        `DELETE FROM customer_legal_acceptances WHERE customer_id = $1`,
        [customer.id]
      );
      deletedRecords += acceptanceResult.rowCount || 0;

      if (options?.keepTransactionRecords) {
        // Anonymize invoices instead of deleting
        await client.query(
          `UPDATE invoices SET 
            billing_address = NULL,
            metadata = NULL,
            notes = NULL
          WHERE customer_id = $1`,
          [customer.id]
        );
        
        // Anonymize the customer record
        await client.query(
          `UPDATE customers SET 
            email = 'deleted_' || id || '@anonymized.local',
            name = 'Deleted Customer',
            stripe_customer_id = NULL,
            metadata = NULL
          WHERE id = $1`,
          [customer.id]
        );
        anonymizedRecords += 1;
      } else {
        // Delete invoices
        const invoiceResult = await client.query(
          `DELETE FROM invoices WHERE customer_id = $1`,
          [customer.id]
        );
        deletedRecords += invoiceResult.rowCount || 0;

        // Delete checkout sessions
        const sessionResult = await client.query(
          `DELETE FROM checkout_sessions WHERE customer_id = $1`,
          [customer.id]
        );
        deletedRecords += sessionResult.rowCount || 0;

        // Delete customer
        const customerResult = await client.query(
          `DELETE FROM customers WHERE id = $1`,
          [customer.id]
        );
        deletedRecords += customerResult.rowCount || 0;
      }

      await client.query('COMMIT');

      // Log deletion
      await this.auditRepo.create({
        developerId,
        action: 'gdpr.data_deleted',
        resourceType: 'customer',
        resourceId: customer.id,
        changes: {
          deletedRecords,
          anonymizedRecords,
          keepTransactionRecords: options?.keepTransactionRecords,
        },
      });

      logger.info('Customer data deleted', {
        customerId: customer.id,
        deletedRecords,
        anonymizedRecords,
      });

      return { deletedRecords, anonymizedRecords };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get GDPR request by ID
   */
  async getRequest(requestId: string): Promise<GDPRRequest | null> {
    const query = `SELECT * FROM gdpr_requests WHERE id = $1`;
    
    try {
      const result = await this.pool.query(query, [requestId]);
      if (result.rows.length === 0) {
        return null;
      }
      return this.mapRowToRequest(result.rows[0]);
    } catch (error) {
      logger.error('Error getting GDPR request', { error, requestId });
      throw error;
    }
  }

  /**
   * List GDPR requests for a developer
   */
  async listRequests(
    developerId: string,
    options?: { status?: GDPRRequestStatus; limit?: number; offset?: number }
  ): Promise<{ requests: GDPRRequest[]; total: number }> {
    const limit = options?.limit || 50;
    const offset = options?.offset || 0;

    let query = `SELECT * FROM gdpr_requests WHERE developer_id = $1`;
    let countQuery = `SELECT COUNT(*) as total FROM gdpr_requests WHERE developer_id = $1`;
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
        this.pool.query(query, values),
        this.pool.query(countQuery, values.slice(0, -2)),
      ]);

      return {
        requests: result.rows.map((row) => this.mapRowToRequest(row)),
        total: parseInt(countResult.rows[0].total, 10),
      };
    } catch (error) {
      logger.error('Error listing GDPR requests', { error, developerId });
      throw error;
    }
  }

  /**
   * Cancel a pending GDPR request
   */
  async cancelRequest(requestId: string): Promise<GDPRRequest | null> {
    const request = await this.getRequest(requestId);
    if (!request || request.status !== 'pending') {
      return null;
    }

    return this.updateRequestStatus(requestId, 'cancelled');
  }

  /**
   * Process data export request
   */
  private async processDataExport(request: GDPRRequest): Promise<void> {
    const exportData = await this.exportCustomerData(
      request.developerId,
      request.customerEmail
    );

    // In production, this would upload to secure storage and generate a signed URL
    const exportJson = JSON.stringify(exportData, null, 2);
    const exportUrl = `data:application/json;base64,${Buffer.from(exportJson).toString('base64')}`;

    // Update request with export URL
    await this.pool.query(
      `UPDATE gdpr_requests SET 
        export_file_url = $1, 
        export_file_expires_at = NOW() + INTERVAL '7 days',
        updated_at = NOW()
      WHERE id = $2`,
      [exportUrl, request.id]
    );

    // Send email notification
    await this.emailSvc.send({
      to: { email: request.customerEmail },
      subject: 'Your Data Export is Ready',
      html: this.getExportReadyEmailHtml(request.customerEmail),
      text: this.getExportReadyEmailText(request.customerEmail),
    });
  }

  /**
   * Process data deletion request
   */
  private async processDataDeletion(request: GDPRRequest): Promise<void> {
    await this.deleteCustomerData(
      request.developerId,
      request.customerEmail,
      { keepTransactionRecords: true } // Keep for legal/tax compliance
    );

    // Send confirmation email
    await this.emailSvc.send({
      to: { email: request.customerEmail },
      subject: 'Your Data Has Been Deleted',
      html: this.getDeletionCompleteEmailHtml(request.customerEmail),
      text: this.getDeletionCompleteEmailText(request.customerEmail),
    });
  }

  /**
   * Update request status
   */
  private async updateRequestStatus(
    requestId: string,
    status: GDPRRequestStatus,
    errorMessage?: string
  ): Promise<GDPRRequest> {
    const updates = [`status = $1`, `updated_at = NOW()`];
    const values: unknown[] = [status];
    let paramIndex = 2;

    if (status === 'processing') {
      updates.push(`processed_at = NOW()`);
    } else if (status === 'completed') {
      updates.push(`completed_at = NOW()`);
    }

    if (errorMessage) {
      updates.push(`error_message = $${paramIndex++}`);
      values.push(errorMessage);
    }

    values.push(requestId);

    const query = `
      UPDATE gdpr_requests SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    const result = await this.pool.query(query, values);
    return this.mapRowToRequest(result.rows[0]);
  }

  /**
   * Map database row to GDPRRequest
   */
  private mapRowToRequest(row: Record<string, unknown>): GDPRRequest {
    return {
      id: row.id as string,
      developerId: row.developer_id as string,
      customerId: row.customer_id as string | null,
      customerEmail: row.customer_email as string,
      requestType: row.request_type as GDPRRequestType,
      status: row.status as GDPRRequestStatus,
      requestedBy: row.requested_by as string,
      reason: row.reason as string | null,
      dataCategories: row.data_categories as string[] | null,
      exportFileUrl: row.export_file_url as string | null,
      exportFileExpiresAt: row.export_file_expires_at
        ? new Date(row.export_file_expires_at as string)
        : null,
      processedAt: row.processed_at ? new Date(row.processed_at as string) : null,
      completedAt: row.completed_at ? new Date(row.completed_at as string) : null,
      errorMessage: row.error_message as string | null,
      metadata: row.metadata as Record<string, unknown> | null,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }

  /**
   * Email templates
   */
  private getExportReadyEmailHtml(_email: string): string {
    return `
<!DOCTYPE html>
<html>
<body style="font-family: sans-serif; line-height: 1.6; color: #333;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <h2>Your Data Export is Ready</h2>
    <p>Hi,</p>
    <p>Your data export request has been processed. You can download your data from your account portal.</p>
    <p>The download link will expire in 7 days for security reasons.</p>
    <p>If you did not request this export, please contact us immediately.</p>
  </div>
</body>
</html>
    `;
  }

  private getExportReadyEmailText(_email: string): string {
    return `Your Data Export is Ready

Your data export request has been processed. You can download your data from your account portal.

The download link will expire in 7 days for security reasons.

If you did not request this export, please contact us immediately.`;
  }

  private getDeletionCompleteEmailHtml(_email: string): string {
    return `
<!DOCTYPE html>
<html>
<body style="font-family: sans-serif; line-height: 1.6; color: #333;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <h2>Your Data Has Been Deleted</h2>
    <p>Hi,</p>
    <p>As requested, your personal data has been deleted from our systems.</p>
    <p>Note: Some transaction records may be retained for legal and tax compliance purposes, but they have been anonymized.</p>
    <p>If you have any questions, please contact us.</p>
  </div>
</body>
</html>
    `;
  }

  private getDeletionCompleteEmailText(_email: string): string {
    return `Your Data Has Been Deleted

As requested, your personal data has been deleted from our systems.

Note: Some transaction records may be retained for legal and tax compliance purposes, but they have been anonymized.

If you have any questions, please contact us.`;
  }
}

// Export singleton instance
export const gdprService = new GDPRService();
