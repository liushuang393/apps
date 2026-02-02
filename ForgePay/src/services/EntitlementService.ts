import { pool } from '../config/database';
import {
  EntitlementRepository,
  entitlementRepository,
  Entitlement,
  CreateEntitlementParams,
} from '../repositories/EntitlementRepository';
import {
  AuditLogRepository,
  auditLogRepository,
} from '../repositories/AuditLogRepository';
import { TokenService, tokenService } from './TokenService';
import { EntitlementStatus } from '../types';
import { logger } from '../utils/logger';

/**
 * Grant entitlement parameters
 */
export interface GrantEntitlementParams {
  customerId: string;
  productId: string;
  purchaseIntentId: string;
  paymentId: string;
  subscriptionId?: string;
  expiresAt?: Date | null;
}

/**
 * Entitlement status result
 */
export interface EntitlementStatusResult {
  hasAccess: boolean;
  status: EntitlementStatus;
  entitlementId: string | null;
  productId: string | null;
  expiresAt: Date | null;
}

/**
 * EntitlementService manages entitlement lifecycle
 * 
 * Responsibilities:
 * - Grant entitlements on successful payment
 * - Check entitlement status
 * - Renew, suspend, and revoke entitlements
 * - Generate unlock tokens
 * 
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7
 */
export class EntitlementService {
  private entitlementRepo: EntitlementRepository;
  private auditLogRepo: AuditLogRepository;
  private tokenSvc: TokenService;

  constructor(
    entitlementRepo: EntitlementRepository = entitlementRepository,
    auditLogRepo: AuditLogRepository = auditLogRepository,
    tokenSvc: TokenService = tokenService
  ) {
    this.entitlementRepo = entitlementRepo;
    this.auditLogRepo = auditLogRepo;
    this.tokenSvc = tokenSvc;
  }

  /**
   * Grant an entitlement to a customer
   * 
   * @param params - Grant parameters
   * @returns Created entitlement and unlock token
   */
  async grantEntitlement(
    params: GrantEntitlementParams
  ): Promise<{ entitlement: Entitlement; unlockToken: string }> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Check if entitlement already exists for this purchase
      const existing = await this.entitlementRepo.findByPurchaseIntentId(
        params.purchaseIntentId,
        client
      );

      if (existing) {
        // Entitlement already exists - generate new token
        const unlockToken = await this.tokenSvc.generateUnlockToken(
          existing.id,
          existing.purchaseIntentId
        );

        await client.query('COMMIT');

        logger.info('Entitlement already exists, returning existing', {
          entitlementId: existing.id,
          purchaseIntentId: params.purchaseIntentId,
        });

        return { entitlement: existing, unlockToken };
      }

      // Create new entitlement
      const createParams: CreateEntitlementParams = {
        customerId: params.customerId,
        productId: params.productId,
        purchaseIntentId: params.purchaseIntentId,
        paymentId: params.paymentId,
        subscriptionId: params.subscriptionId,
        status: 'active',
        expiresAt: params.expiresAt,
      };

      const entitlement = await this.entitlementRepo.create(createParams, client);

      // Log audit entry
      await this.auditLogRepo.create(
        {
          action: 'entitlement.granted',
          resourceType: 'entitlement',
          resourceId: entitlement.id,
          changes: {
            status: 'active',
            productId: params.productId,
            customerId: params.customerId,
            purchaseIntentId: params.purchaseIntentId,
          },
        },
        client
      );

      await client.query('COMMIT');

      // Generate unlock token
      const unlockToken = await this.tokenSvc.generateUnlockToken(
        entitlement.id,
        entitlement.purchaseIntentId
      );

      logger.info('Entitlement granted', {
        entitlementId: entitlement.id,
        customerId: params.customerId,
        productId: params.productId,
        purchaseIntentId: params.purchaseIntentId,
      });

      return { entitlement, unlockToken };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error granting entitlement', {
        error,
        params,
      });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Check entitlement status by purchase intent ID
   * 
   * @param purchaseIntentId - OpenAI purchase intent ID
   * @returns Entitlement status
   */
  async checkEntitlementStatus(
    purchaseIntentId: string
  ): Promise<EntitlementStatusResult> {
    const entitlement = await this.entitlementRepo.findByPurchaseIntentId(
      purchaseIntentId
    );

    if (!entitlement) {
      return {
        hasAccess: false,
        status: 'expired',
        entitlementId: null,
        productId: null,
        expiresAt: null,
      };
    }

    // Check if expired
    const isExpired =
      entitlement.expiresAt !== null && entitlement.expiresAt < new Date();

    const hasAccess =
      entitlement.status === 'active' && !isExpired;

    return {
      hasAccess,
      status: isExpired && entitlement.status === 'active' 
        ? 'expired' 
        : entitlement.status,
      entitlementId: entitlement.id,
      productId: entitlement.productId,
      expiresAt: entitlement.expiresAt,
    };
  }

  /**
   * Verify unlock token and return entitlement status
   * 
   * @param unlockToken - JWT unlock token
   * @returns Entitlement status or error
   */
  async verifyUnlockToken(unlockToken: string): Promise<{
    valid: boolean;
    status?: EntitlementStatusResult;
    error?: string;
  }> {
    const verification = await this.tokenSvc.verifyUnlockToken(unlockToken);

    if (!verification.valid || !verification.payload) {
      return {
        valid: false,
        error: verification.error,
      };
    }

    const status = await this.checkEntitlementStatus(
      verification.payload.purchaseIntentId
    );

    return {
      valid: true,
      status,
    };
  }

  /**
   * Renew an entitlement (extend expiration)
   * 
   * @param entitlementId - Entitlement ID
   * @param newExpiresAt - New expiration date
   * @returns Updated entitlement
   */
  async renewEntitlement(
    entitlementId: string,
    newExpiresAt: Date
  ): Promise<Entitlement | null> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const entitlement = await this.entitlementRepo.findById(entitlementId, client);

      if (!entitlement) {
        await client.query('ROLLBACK');
        return null;
      }

      const oldExpiresAt = entitlement.expiresAt;

      const updated = await this.entitlementRepo.extendExpiration(
        entitlementId,
        newExpiresAt,
        client
      );

      // Log audit entry
      await this.auditLogRepo.create(
        {
          action: 'entitlement.renewed',
          resourceType: 'entitlement',
          resourceId: entitlementId,
          changes: {
            oldExpiresAt: oldExpiresAt?.toISOString(),
            newExpiresAt: newExpiresAt.toISOString(),
          },
        },
        client
      );

      await client.query('COMMIT');

      logger.info('Entitlement renewed', {
        entitlementId,
        oldExpiresAt,
        newExpiresAt,
      });

      return updated;
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error renewing entitlement', {
        error,
        entitlementId,
        newExpiresAt,
      });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Suspend an entitlement (payment failure)
   * 
   * @param entitlementId - Entitlement ID
   * @param reason - Suspension reason
   * @returns Updated entitlement
   */
  async suspendEntitlement(
    entitlementId: string,
    reason: string
  ): Promise<Entitlement | null> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const entitlement = await this.entitlementRepo.findById(entitlementId, client);

      if (!entitlement) {
        await client.query('ROLLBACK');
        return null;
      }

      const oldStatus = entitlement.status;

      const updated = await this.entitlementRepo.suspend(
        entitlementId,
        reason,
        client
      );

      // Log audit entry
      await this.auditLogRepo.create(
        {
          action: 'entitlement.suspended',
          resourceType: 'entitlement',
          resourceId: entitlementId,
          changes: {
            oldStatus,
            newStatus: 'suspended',
            reason,
          },
        },
        client
      );

      await client.query('COMMIT');

      logger.info('Entitlement suspended', {
        entitlementId,
        reason,
      });

      return updated;
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error suspending entitlement', {
        error,
        entitlementId,
        reason,
      });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Revoke an entitlement (refund or chargeback)
   * 
   * @param entitlementId - Entitlement ID
   * @param reason - Revocation reason
   * @returns Updated entitlement
   */
  async revokeEntitlement(
    entitlementId: string,
    reason: string
  ): Promise<Entitlement | null> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const entitlement = await this.entitlementRepo.findById(entitlementId, client);

      if (!entitlement) {
        await client.query('ROLLBACK');
        return null;
      }

      const oldStatus = entitlement.status;

      const updated = await this.entitlementRepo.revoke(
        entitlementId,
        reason,
        client
      );

      // Log audit entry
      await this.auditLogRepo.create(
        {
          action: 'entitlement.revoked',
          resourceType: 'entitlement',
          resourceId: entitlementId,
          changes: {
            oldStatus,
            newStatus: 'revoked',
            reason,
          },
        },
        client
      );

      await client.query('COMMIT');

      logger.info('Entitlement revoked', {
        entitlementId,
        reason,
      });

      return updated;
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error revoking entitlement', {
        error,
        entitlementId,
        reason,
      });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Reactivate an entitlement (won chargeback)
   * 
   * @param entitlementId - Entitlement ID
   * @returns Updated entitlement
   */
  async reactivateEntitlement(
    entitlementId: string
  ): Promise<Entitlement | null> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const entitlement = await this.entitlementRepo.findById(entitlementId, client);

      if (!entitlement) {
        await client.query('ROLLBACK');
        return null;
      }

      const oldStatus = entitlement.status;

      const updated = await this.entitlementRepo.reactivate(entitlementId, client);

      // Log audit entry
      await this.auditLogRepo.create(
        {
          action: 'entitlement.reactivated',
          resourceType: 'entitlement',
          resourceId: entitlementId,
          changes: {
            oldStatus,
            newStatus: 'active',
          },
        },
        client
      );

      await client.query('COMMIT');

      logger.info('Entitlement reactivated', {
        entitlementId,
      });

      return updated;
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error reactivating entitlement', {
        error,
        entitlementId,
      });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get entitlement by ID
   * 
   * @param entitlementId - Entitlement ID
   * @returns Entitlement or null
   */
  async getEntitlement(entitlementId: string): Promise<Entitlement | null> {
    return this.entitlementRepo.findById(entitlementId);
  }

  /**
   * Get entitlement by purchase intent ID
   * 
   * @param purchaseIntentId - Purchase intent ID
   * @returns Entitlement or null
   */
  async getEntitlementByPurchaseIntentId(
    purchaseIntentId: string
  ): Promise<Entitlement | null> {
    return this.entitlementRepo.findByPurchaseIntentId(purchaseIntentId);
  }

  /**
   * Get entitlement by subscription ID
   * 
   * @param subscriptionId - Stripe subscription ID
   * @returns Entitlement or null
   */
  async getEntitlementBySubscriptionId(
    subscriptionId: string
  ): Promise<Entitlement | null> {
    return this.entitlementRepo.findBySubscriptionId(subscriptionId);
  }

  /**
   * Get all entitlements for a customer
   * 
   * @param customerId - Customer ID
   * @returns Array of entitlements
   */
  async getEntitlementsByCustomerId(customerId: string): Promise<Entitlement[]> {
    return this.entitlementRepo.findByCustomerId(customerId);
  }

  /**
   * Get active entitlements for a customer
   * 
   * @param customerId - Customer ID
   * @returns Array of active entitlements
   */
  async getActiveEntitlementsByCustomerId(
    customerId: string
  ): Promise<Entitlement[]> {
    return this.entitlementRepo.findActiveByCustomerId(customerId);
  }
}

// Export singleton instance
export const entitlementService = new EntitlementService();
