import Stripe from 'stripe';
import { config } from '../config';
import { logger } from '../utils/logger';
import { AuditLogRepository, auditLogRepository } from '../repositories/AuditLogRepository';

// Type alias for Stripe rule
type StripeRule = Stripe.Charge.Outcome.Rule & { id?: string };

/**
 * Fraud risk level
 */
export type FraudRiskLevel = 'low' | 'medium' | 'high' | 'highest';

/**
 * Fraud check result
 */
export interface FraudCheckResult {
  riskLevel: FraudRiskLevel;
  riskScore: number;
  isBlocked: boolean;
  reasons: string[];
  radarRule?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Fraud event from Stripe Radar
 */
export interface FraudEvent {
  eventId: string;
  paymentIntentId: string;
  chargeId?: string;
  customerId?: string;
  type: 'early_fraud_warning' | 'radar_review' | 'dispute';
  riskLevel: FraudRiskLevel;
  reason: string;
  timestamp: Date;
}

/**
 * Fraud prevention settings
 */
export interface FraudPreventionSettings {
  enabled: boolean;
  blockHighRisk: boolean;
  reviewThreshold: FraudRiskLevel;
  customRules: {
    maxTransactionAmount?: number;
    blockCountries?: string[];
    requireCvc?: boolean;
    require3ds?: boolean;
  };
}

/**
 * FraudService handles fraud prevention using Stripe Radar
 * 
 * Requirements: 10.5, 10.6
 */
export class FraudService {
  private stripe: Stripe;
  private auditRepo: AuditLogRepository;
  private settings: FraudPreventionSettings;

  constructor(
    apiKey: string = config.stripe.secretKey,
    auditRepo: AuditLogRepository = auditLogRepository
  ) {
    this.stripe = new Stripe(apiKey, {
      apiVersion: '2023-10-16',
    });
    this.auditRepo = auditRepo;
    
    // Default settings
    this.settings = {
      enabled: true,
      blockHighRisk: true,
      reviewThreshold: 'medium',
      customRules: {
        requireCvc: true,
        require3ds: false,
      },
    };
  }

  /**
   * Analyze payment for fraud risk
   */
  async analyzePayment(
    paymentIntentId: string,
    developerId: string
  ): Promise<FraudCheckResult> {
    try {
      const paymentIntent = await this.stripe.paymentIntents.retrieve(
        paymentIntentId,
        {
          expand: ['latest_charge.outcome', 'latest_charge'],
        }
      );

      const charge = paymentIntent.latest_charge as Stripe.Charge | null;
      const outcome = charge?.outcome;

      if (!outcome) {
        return {
          riskLevel: 'low',
          riskScore: 0,
          isBlocked: false,
          reasons: ['No fraud analysis available'],
        };
      }

      const riskLevel = this.mapRiskLevel(outcome.risk_level || 'normal');
      const riskScore = outcome.risk_score || 0;
      const isBlocked = this.shouldBlock(riskLevel, outcome);

      const result: FraudCheckResult = {
        riskLevel,
        riskScore,
        isBlocked,
        reasons: this.extractReasons(outcome),
        radarRule: (outcome.rule as StripeRule)?.id,
        metadata: {
          network_status: outcome.network_status,
          seller_message: outcome.seller_message,
          type: outcome.type,
        },
      };

      // Log fraud check
      await this.logFraudCheck(developerId, paymentIntentId, result);

      if (isBlocked) {
        logger.warn('Payment blocked by fraud prevention', {
          paymentIntentId,
          riskLevel,
          riskScore,
        });
      }

      return result;
    } catch (error) {
      logger.error('Error analyzing payment for fraud', { error, paymentIntentId });
      
      // Return safe default on error
      return {
        riskLevel: 'low',
        riskScore: 0,
        isBlocked: false,
        reasons: ['Fraud analysis unavailable'],
      };
    }
  }

  /**
   * Handle early fraud warning
   */
  async handleEarlyFraudWarning(
    event: Stripe.Radar.EarlyFraudWarning,
    developerId: string
  ): Promise<void> {
    logger.warn('Early fraud warning received', {
      eventId: event.id,
      chargeId: event.charge,
      fraudType: event.fraud_type,
    });

    // Log to audit
    await this.auditRepo.create({
      developerId,
      action: 'fraud.early_warning',
      resourceType: 'payment',
      resourceId: event.payment_intent as string,
      changes: {
        fraudType: event.fraud_type,
        chargeId: event.charge,
        actionable: event.actionable,
      },
    });

    // If actionable, could trigger refund process
    if (event.actionable) {
      logger.info('Actionable fraud warning - consider refund', {
        chargeId: event.charge,
      });
    }
  }

  /**
   * Handle Radar review decision
   */
  async handleReviewDecision(
    review: Stripe.Review,
    developerId: string
  ): Promise<void> {
    const isApproved = review.closed_reason === 'approved';
    
    logger.info('Radar review decision', {
      reviewId: review.id,
      paymentIntentId: review.payment_intent,
      decision: review.closed_reason,
      isApproved,
    });

    await this.auditRepo.create({
      developerId,
      action: isApproved ? 'fraud.review_approved' : 'fraud.review_rejected',
      resourceType: 'payment',
      resourceId: review.payment_intent as string,
      changes: {
        reviewId: review.id,
        reason: review.reason,
        closedReason: review.closed_reason,
      },
    });
  }

  /**
   * Handle dispute
   */
  async handleDispute(
    dispute: Stripe.Dispute,
    developerId: string
  ): Promise<{ shouldChallenge: boolean; evidence?: Record<string, string> }> {
    logger.warn('Dispute received', {
      disputeId: dispute.id,
      reason: dispute.reason,
      amount: dispute.amount,
      status: dispute.status,
    });

    await this.auditRepo.create({
      developerId,
      action: 'fraud.dispute_received',
      resourceType: 'payment',
      resourceId: dispute.payment_intent as string,
      changes: {
        disputeId: dispute.id,
        reason: dispute.reason,
        amount: dispute.amount,
        currency: dispute.currency,
        status: dispute.status,
      },
    });

    // Determine if we should challenge the dispute
    const shouldChallenge = this.shouldChallengeDispute(dispute);

    if (shouldChallenge) {
      return {
        shouldChallenge: true,
        evidence: {
          // Evidence would be gathered from the actual transaction
          product_description: 'Digital product/subscription',
          service_documentation: 'Customer agreed to terms of service',
        },
      };
    }

    return { shouldChallenge: false };
  }

  /**
   * Get fraud statistics for a developer
   */
  async getFraudStats(
    _developerId: string,
    _startDate: Date,
    _endDate: Date
  ): Promise<{
    totalTransactions: number;
    blockedTransactions: number;
    earlyWarnings: number;
    disputes: number;
    disputeRate: number;
  }> {
    // In a real implementation, this would query the database
    // For now, return mock stats
    return {
      totalTransactions: 0,
      blockedTransactions: 0,
      earlyWarnings: 0,
      disputes: 0,
      disputeRate: 0,
    };
  }

  /**
   * Update fraud prevention settings
   */
  updateSettings(settings: Partial<FraudPreventionSettings>): void {
    this.settings = { ...this.settings, ...settings };
    logger.info('Fraud prevention settings updated', { settings: this.settings });
  }

  /**
   * Get current settings
   */
  getSettings(): FraudPreventionSettings {
    return { ...this.settings };
  }

  /**
   * Map Stripe risk level to our risk level
   */
  private mapRiskLevel(stripeLevel: string): FraudRiskLevel {
    switch (stripeLevel) {
      case 'highest':
        return 'highest';
      case 'elevated':
      case 'high':
        return 'high';
      case 'normal':
        return 'medium';
      default:
        return 'low';
    }
  }

  /**
   * Determine if payment should be blocked
   */
  private shouldBlock(
    riskLevel: FraudRiskLevel,
    outcome: Stripe.Charge.Outcome
  ): boolean {
    if (!this.settings.enabled) {
      return false;
    }

    // Block if Stripe blocked it
    if (outcome.type === 'blocked') {
      return true;
    }

    // Block high risk if setting enabled
    if (this.settings.blockHighRisk && (riskLevel === 'high' || riskLevel === 'highest')) {
      return true;
    }

    return false;
  }

  /**
   * Extract reasons from outcome
   */
  private extractReasons(outcome: Stripe.Charge.Outcome): string[] {
    const reasons: string[] = [];

    if (outcome.seller_message) {
      reasons.push(outcome.seller_message);
    }

    if (outcome.risk_level === 'elevated') {
      reasons.push('Elevated risk detected by Stripe Radar');
    }

    if (outcome.risk_level === 'highest') {
      reasons.push('Highest risk detected by Stripe Radar');
    }

    if (outcome.rule) {
      reasons.push(`Matched rule: ${(outcome.rule as StripeRule).id || 'unknown'}`);
    }

    return reasons.length > 0 ? reasons : ['No specific concerns'];
  }

  /**
   * Determine if dispute should be challenged
   */
  private shouldChallengeDispute(dispute: Stripe.Dispute): boolean {
    // Don't challenge if evidence already submitted
    if (dispute.evidence_details?.has_evidence) {
      return false;
    }

    // Challenge if dispute is in a challengeable state
    const challengeableStatuses = ['needs_response', 'warning_needs_response'];
    if (!challengeableStatuses.includes(dispute.status)) {
      return false;
    }

    // Challenge fraudulent disputes by default
    if (dispute.reason === 'fraudulent') {
      return true;
    }

    return true;
  }

  /**
   * Log fraud check to audit
   */
  private async logFraudCheck(
    developerId: string,
    paymentIntentId: string,
    result: FraudCheckResult
  ): Promise<void> {
    await this.auditRepo.create({
      developerId,
      action: 'fraud.check',
      resourceType: 'payment',
      resourceId: paymentIntentId,
      changes: {
        riskLevel: result.riskLevel,
        riskScore: result.riskScore,
        isBlocked: result.isBlocked,
        reasons: result.reasons,
      },
    });
  }
}

// Export singleton instance
export const fraudService = new FraudService();
