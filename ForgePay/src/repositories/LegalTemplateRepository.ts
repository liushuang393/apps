import { Pool, PoolClient } from 'pg';
import { pool } from '../config/database';
import { logger } from '../utils/logger';

/**
 * Legal template types
 */
export type LegalTemplateType = 'terms_of_service' | 'privacy_policy' | 'refund_policy';

/**
 * Legal template entity
 */
export interface LegalTemplate {
  id: string;
  developerId: string;
  type: LegalTemplateType;
  version: number;
  title: string;
  content: string;
  contentHtml: string | null;
  language: string;
  isActive: boolean;
  isDefault: boolean;
  effectiveDate: Date | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Customer legal acceptance record
 */
export interface CustomerLegalAcceptance {
  id: string;
  customerId: string;
  templateId: string;
  templateType: LegalTemplateType;
  templateVersion: number;
  acceptedAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
}

/**
 * Parameters for creating a legal template
 */
export interface CreateLegalTemplateParams {
  developerId: string;
  type: LegalTemplateType;
  title: string;
  content: string;
  contentHtml?: string;
  language?: string;
  isDefault?: boolean;
  effectiveDate?: Date;
  metadata?: Record<string, unknown>;
}

/**
 * Parameters for updating a legal template
 */
export interface UpdateLegalTemplateParams {
  title?: string;
  content?: string;
  contentHtml?: string;
  language?: string;
  isActive?: boolean;
  effectiveDate?: Date;
  metadata?: Record<string, unknown>;
}

/**
 * Parameters for recording acceptance
 */
export interface RecordAcceptanceParams {
  customerId: string;
  templateId: string;
  templateType: LegalTemplateType;
  templateVersion: number;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * LegalTemplateRepository handles all database operations for legal templates
 * 
 * Requirements: 9.1, 9.2, 9.4
 */
export class LegalTemplateRepository {
  private pool: Pool;

  constructor(dbPool: Pool = pool) {
    this.pool = dbPool;
  }

  /**
   * Create a new legal template
   */
  async create(
    params: CreateLegalTemplateParams,
    client?: PoolClient
  ): Promise<LegalTemplate> {
    const dbClient = client || this.pool;

    // Get the next version number for this type
    const versionQuery = `
      SELECT COALESCE(MAX(version), 0) + 1 as next_version
      FROM legal_templates
      WHERE developer_id = $1 AND type = $2
    `;
    const versionResult = await dbClient.query(versionQuery, [
      params.developerId,
      params.type,
    ]);
    const version = versionResult.rows[0].next_version;

    // If this is the first template of this type, make it active
    const isFirstOfType = version === 1;

    const query = `
      INSERT INTO legal_templates (
        developer_id, type, version, title, content, content_html,
        language, is_active, is_default, effective_date, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `;

    const values = [
      params.developerId,
      params.type,
      version,
      params.title,
      params.content,
      params.contentHtml || null,
      params.language || 'en',
      isFirstOfType, // First template is automatically active
      params.isDefault || false,
      params.effectiveDate || null,
      params.metadata ? JSON.stringify(params.metadata) : null,
    ];

    try {
      const result = await dbClient.query(query, values);
      const template = this.mapRowToTemplate(result.rows[0]);

      logger.info('Legal template created', {
        templateId: template.id,
        type: template.type,
        version: template.version,
      });

      return template;
    } catch (error) {
      logger.error('Error creating legal template', { error, params });
      throw error;
    }
  }

  /**
   * Create a new version of an existing template
   */
  async createNewVersion(
    templateId: string,
    params: {
      title?: string;
      content: string;
      contentHtml?: string;
      effectiveDate?: Date;
    },
    client?: PoolClient
  ): Promise<LegalTemplate> {
    // Get the existing template
    const existing = await this.findById(templateId, client);
    if (!existing) {
      throw new Error('Template not found');
    }

    // Create new version
    return this.create(
      {
        developerId: existing.developerId,
        type: existing.type,
        title: params.title || existing.title,
        content: params.content,
        contentHtml: params.contentHtml,
        language: existing.language,
        effectiveDate: params.effectiveDate,
        metadata: existing.metadata || undefined,
      },
      client
    );
  }

  /**
   * Find a template by ID
   */
  async findById(id: string, client?: PoolClient): Promise<LegalTemplate | null> {
    const dbClient = client || this.pool;

    const query = `SELECT * FROM legal_templates WHERE id = $1`;

    try {
      const result = await dbClient.query(query, [id]);
      if (result.rows.length === 0) {
        return null;
      }
      return this.mapRowToTemplate(result.rows[0]);
    } catch (error) {
      logger.error('Error finding legal template', { error, id });
      throw error;
    }
  }

  /**
   * Find active template by developer and type
   */
  async findActiveByDeveloperAndType(
    developerId: string,
    type: LegalTemplateType,
    client?: PoolClient
  ): Promise<LegalTemplate | null> {
    const dbClient = client || this.pool;

    const query = `
      SELECT * FROM legal_templates
      WHERE developer_id = $1 AND type = $2 AND is_active = true
      LIMIT 1
    `;

    try {
      const result = await dbClient.query(query, [developerId, type]);
      if (result.rows.length === 0) {
        return null;
      }
      return this.mapRowToTemplate(result.rows[0]);
    } catch (error) {
      logger.error('Error finding active legal template', { error, developerId, type });
      throw error;
    }
  }

  /**
   * Find all templates for a developer
   */
  async findByDeveloperId(
    developerId: string,
    options?: { type?: LegalTemplateType; activeOnly?: boolean },
    client?: PoolClient
  ): Promise<LegalTemplate[]> {
    const dbClient = client || this.pool;

    let query = `SELECT * FROM legal_templates WHERE developer_id = $1`;
    const values: unknown[] = [developerId];
    let paramIndex = 2;

    if (options?.type) {
      query += ` AND type = $${paramIndex++}`;
      values.push(options.type);
    }

    if (options?.activeOnly) {
      query += ` AND is_active = true`;
    }

    query += ` ORDER BY type, version DESC`;

    try {
      const result = await dbClient.query(query, values);
      return result.rows.map((row) => this.mapRowToTemplate(row));
    } catch (error) {
      logger.error('Error finding legal templates', { error, developerId });
      throw error;
    }
  }

  /**
   * Find all versions of a template type
   */
  async findVersionHistory(
    developerId: string,
    type: LegalTemplateType,
    client?: PoolClient
  ): Promise<LegalTemplate[]> {
    const dbClient = client || this.pool;

    const query = `
      SELECT * FROM legal_templates
      WHERE developer_id = $1 AND type = $2
      ORDER BY version DESC
    `;

    try {
      const result = await dbClient.query(query, [developerId, type]);
      return result.rows.map((row) => this.mapRowToTemplate(row));
    } catch (error) {
      logger.error('Error finding template version history', { error, developerId, type });
      throw error;
    }
  }

  /**
   * Activate a template (deactivates other versions of same type)
   */
  async activate(
    id: string,
    client?: PoolClient
  ): Promise<LegalTemplate | null> {
    const dbClient = client || this.pool;

    // Get the template to activate
    const template = await this.findById(id, client);
    if (!template) {
      return null;
    }

    // Deactivate other templates of the same type
    const deactivateQuery = `
      UPDATE legal_templates
      SET is_active = false, updated_at = NOW()
      WHERE developer_id = $1 AND type = $2 AND id != $3
    `;
    await dbClient.query(deactivateQuery, [
      template.developerId,
      template.type,
      id,
    ]);

    // Activate this template
    const activateQuery = `
      UPDATE legal_templates
      SET is_active = true, updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `;

    try {
      const result = await dbClient.query(activateQuery, [id]);
      if (result.rows.length === 0) {
        return null;
      }

      logger.info('Legal template activated', { templateId: id });
      return this.mapRowToTemplate(result.rows[0]);
    } catch (error) {
      logger.error('Error activating legal template', { error, id });
      throw error;
    }
  }

  /**
   * Update a template
   */
  async update(
    id: string,
    params: UpdateLegalTemplateParams,
    client?: PoolClient
  ): Promise<LegalTemplate | null> {
    const dbClient = client || this.pool;

    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (params.title !== undefined) {
      updates.push(`title = $${paramIndex++}`);
      values.push(params.title);
    }
    if (params.content !== undefined) {
      updates.push(`content = $${paramIndex++}`);
      values.push(params.content);
    }
    if (params.contentHtml !== undefined) {
      updates.push(`content_html = $${paramIndex++}`);
      values.push(params.contentHtml);
    }
    if (params.language !== undefined) {
      updates.push(`language = $${paramIndex++}`);
      values.push(params.language);
    }
    if (params.effectiveDate !== undefined) {
      updates.push(`effective_date = $${paramIndex++}`);
      values.push(params.effectiveDate);
    }
    if (params.metadata !== undefined) {
      updates.push(`metadata = $${paramIndex++}`);
      values.push(JSON.stringify(params.metadata));
    }

    if (updates.length === 0) {
      return this.findById(id, client);
    }

    updates.push(`updated_at = NOW()`);
    values.push(id);

    const query = `
      UPDATE legal_templates
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    try {
      const result = await dbClient.query(query, values);
      if (result.rows.length === 0) {
        return null;
      }
      return this.mapRowToTemplate(result.rows[0]);
    } catch (error) {
      logger.error('Error updating legal template', { error, id });
      throw error;
    }
  }

  /**
   * Delete a template (only if not active and no acceptances)
   */
  async delete(id: string, client?: PoolClient): Promise<boolean> {
    const dbClient = client || this.pool;

    // Check if template has any acceptances
    const acceptanceCheck = `
      SELECT COUNT(*) as count FROM customer_legal_acceptances WHERE template_id = $1
    `;
    const acceptanceResult = await dbClient.query(acceptanceCheck, [id]);
    if (parseInt(acceptanceResult.rows[0].count) > 0) {
      throw new Error('Cannot delete template with existing acceptances');
    }

    const query = `
      DELETE FROM legal_templates
      WHERE id = $1 AND is_active = false
    `;

    try {
      const result = await dbClient.query(query, [id]);
      const deleted = result.rowCount !== null && result.rowCount > 0;
      
      if (deleted) {
        logger.info('Legal template deleted', { templateId: id });
      }
      
      return deleted;
    } catch (error) {
      logger.error('Error deleting legal template', { error, id });
      throw error;
    }
  }

  /**
   * Record customer acceptance of a template
   */
  async recordAcceptance(
    params: RecordAcceptanceParams,
    client?: PoolClient
  ): Promise<CustomerLegalAcceptance> {
    const dbClient = client || this.pool;

    const query = `
      INSERT INTO customer_legal_acceptances (
        customer_id, template_id, template_type, template_version,
        ip_address, user_agent
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;

    const values = [
      params.customerId,
      params.templateId,
      params.templateType,
      params.templateVersion,
      params.ipAddress || null,
      params.userAgent || null,
    ];

    try {
      const result = await dbClient.query(query, values);
      const acceptance = this.mapRowToAcceptance(result.rows[0]);

      logger.info('Legal acceptance recorded', {
        customerId: params.customerId,
        templateType: params.templateType,
        templateVersion: params.templateVersion,
      });

      return acceptance;
    } catch (error) {
      logger.error('Error recording legal acceptance', { error, params });
      throw error;
    }
  }

  /**
   * Get customer's acceptances
   */
  async getCustomerAcceptances(
    customerId: string,
    client?: PoolClient
  ): Promise<CustomerLegalAcceptance[]> {
    const dbClient = client || this.pool;

    const query = `
      SELECT * FROM customer_legal_acceptances
      WHERE customer_id = $1
      ORDER BY accepted_at DESC
    `;

    try {
      const result = await dbClient.query(query, [customerId]);
      return result.rows.map((row) => this.mapRowToAcceptance(row));
    } catch (error) {
      logger.error('Error getting customer acceptances', { error, customerId });
      throw error;
    }
  }

  /**
   * Check if customer has accepted latest version of a template type
   */
  async hasAcceptedLatest(
    customerId: string,
    developerId: string,
    type: LegalTemplateType,
    client?: PoolClient
  ): Promise<boolean> {
    const dbClient = client || this.pool;

    const query = `
      SELECT EXISTS (
        SELECT 1 FROM customer_legal_acceptances a
        JOIN legal_templates t ON a.template_id = t.id
        WHERE a.customer_id = $1
        AND t.developer_id = $2
        AND t.type = $3
        AND t.is_active = true
      ) as accepted
    `;

    try {
      const result = await dbClient.query(query, [customerId, developerId, type]);
      return result.rows[0].accepted;
    } catch (error) {
      logger.error('Error checking acceptance', { error, customerId, type });
      throw error;
    }
  }

  /**
   * Map database row to LegalTemplate entity
   */
  private mapRowToTemplate(row: Record<string, unknown>): LegalTemplate {
    return {
      id: row.id as string,
      developerId: row.developer_id as string,
      type: row.type as LegalTemplateType,
      version: row.version as number,
      title: row.title as string,
      content: row.content as string,
      contentHtml: row.content_html as string | null,
      language: row.language as string,
      isActive: row.is_active as boolean,
      isDefault: row.is_default as boolean,
      effectiveDate: row.effective_date ? new Date(row.effective_date as string) : null,
      metadata: row.metadata as Record<string, unknown> | null,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }

  /**
   * Map database row to CustomerLegalAcceptance entity
   */
  private mapRowToAcceptance(row: Record<string, unknown>): CustomerLegalAcceptance {
    return {
      id: row.id as string,
      customerId: row.customer_id as string,
      templateId: row.template_id as string,
      templateType: row.template_type as LegalTemplateType,
      templateVersion: row.template_version as number,
      acceptedAt: new Date(row.accepted_at as string),
      ipAddress: row.ip_address as string | null,
      userAgent: row.user_agent as string | null,
    };
  }
}

// Export singleton instance
export const legalTemplateRepository = new LegalTemplateRepository();
