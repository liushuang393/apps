import Stripe from 'stripe';
import {
  WebhookLogRepository,
  webhookLogRepository,
  WebhookLog,
} from '../repositories/WebhookLogRepository';
import {
  CustomerRepository,
  customerRepository,
} from '../repositories/CustomerRepository';
import {
  CheckoutSessionRepository,
  checkoutSessionRepository,
} from '../repositories/CheckoutSessionRepository';
import { productRepository } from '../repositories/ProductRepository';
import { EntitlementService, entitlementService } from './EntitlementService';
import { StripeClient, stripeClient } from './StripeClient';
import { StripeClientFactory, stripeClientFactory } from './StripeClientFactory';
import { DeveloperRepository, developerRepository } from '../repositories/DeveloperRepository';
import { CallbackService, callbackService, CallbackEventType } from './CallbackService';
import { logger } from '../utils/logger';

/**
 * Webhook 処理結果
 */
export interface ProcessResult {
  success: boolean;
  eventId: string;
  eventType: string;
  processed: boolean;
  error?: string;
}

/**
 * リトライ設定
 */
const RETRY_INTERVALS = [
  60 * 1000,          // 1分
  5 * 60 * 1000,      // 5分
  15 * 60 * 1000,     // 15分
  60 * 60 * 1000,     // 1時間
  6 * 60 * 60 * 1000, // 6時間
];

const MAX_RETRY_ATTEMPTS = 5;

/**
 * WebhookProcessor — Stripe Webhook イベントの冪等処理
 *
 * 薄いレイヤーとして以下のみを担当:
 * - Webhook 署名検証
 * - 冪等性保証（イベントID重複チェック）
 * - イベントルーティング → Entitlement 状態遷移
 * - リトライ / DLQ 管理
 *
 * メール通知・請求書生成は Stripe に委譲（Stripe Dashboard で設定）
 */
export class WebhookProcessor {
  private webhookLogRepo: WebhookLogRepository;
  private customerRepo: CustomerRepository;
  private checkoutSessionRepo: CheckoutSessionRepository;
  private entitlementSvc: EntitlementService;
  private stripe: StripeClient;
  private stripeFactory: StripeClientFactory;
  private developerRepo: DeveloperRepository;
  private callbackSvc: CallbackService;

  constructor(
    webhookLogRepo: WebhookLogRepository = webhookLogRepository,
    customerRepo: CustomerRepository = customerRepository,
    checkoutSessionRepo: CheckoutSessionRepository = checkoutSessionRepository,
    entitlementSvc: EntitlementService = entitlementService,
    stripe: StripeClient = stripeClient,
    callbackSvc: CallbackService = callbackService,
    stripeFactory: StripeClientFactory = stripeClientFactory,
    devRepo: DeveloperRepository = developerRepository
  ) {
    this.webhookLogRepo = webhookLogRepo;
    this.customerRepo = customerRepo;
    this.checkoutSessionRepo = checkoutSessionRepo;
    this.entitlementSvc = entitlementSvc;
    this.stripe = stripe;
    this.stripeFactory = stripeFactory;
    this.developerRepo = devRepo;
    this.callbackSvc = callbackSvc;
  }

  /**
   * 開発者IDからStripeクライアントを取得（マルチテナント対応）
   */
  private async getStripeClientForDeveloper(developerId: string): Promise<StripeClient> {
    const developer = await this.developerRepo.findById(developerId);
    return this.stripeFactory.getClient(
      developer?.stripeSecretKeyEnc || null,
      developerId
    );
  }

  /**
   * Webhook イベントを処理（冪等性付き）
   */
  async processWebhook(
    payload: string | Buffer,
    signature: string
  ): Promise<ProcessResult> {
    let event: Stripe.Event;

    // 署名検証
    try {
      event = this.stripe.verifyWebhookSignature(payload, signature);
    } catch (error) {
      logger.warn('Webhook 署名検証失敗', { error });
      return {
        success: false,
        eventId: '',
        eventType: '',
        processed: false,
        error: 'Invalid signature',
      };
    }

    // 冪等性チェック
    const existingLog = await this.webhookLogRepo.findByStripeEventId(event.id);
    if (existingLog && existingLog.status === 'processed') {
      logger.info('Webhook イベント処理済み（スキップ）', {
        stripeEventId: event.id,
        eventType: event.type,
      });
      return {
        success: true,
        eventId: event.id,
        eventType: event.type,
        processed: false,
      };
    }

    // Webhook ログを作成または更新
    let webhookLog: WebhookLog;
    if (existingLog) {
      webhookLog = existingLog;
    } else {
      webhookLog = await this.webhookLogRepo.create({
        stripeEventId: event.id,
        eventType: event.type,
        payload: event as any,
        signature,
        status: 'pending',
      });
    }

    // イベント処理
    try {
      await this.handleEvent(event);

      await this.webhookLogRepo.markProcessed(webhookLog.id);

      logger.info('Webhook イベント処理成功', {
        stripeEventId: event.id,
        eventType: event.type,
      });

      return {
        success: true,
        eventId: event.id,
        eventType: event.type,
        processed: true,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      const attempts = webhookLog.attempts + 1;
      if (attempts >= MAX_RETRY_ATTEMPTS) {
        await this.webhookLogRepo.moveToDLQ(webhookLog.id, errorMessage);
        logger.error('Webhook を DLQ に移動（リトライ上限到達）', {
          stripeEventId: event.id,
          eventType: event.type,
          attempts,
          error: errorMessage,
        });
      } else {
        await this.webhookLogRepo.markFailed(webhookLog.id, errorMessage);
        logger.error('Webhook 処理失敗（リトライ予定）', {
          stripeEventId: event.id,
          eventType: event.type,
          attempts,
          error: errorMessage,
        });
      }

      return {
        success: false,
        eventId: event.id,
        eventType: event.type,
        processed: false,
        error: errorMessage,
      };
    }
  }

  /**
   * イベントを適切なハンドラにルーティング
   */
  private async handleEvent(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'checkout.session.completed':
        await this.handleCheckoutSessionCompleted(event);
        break;
      case 'invoice.paid':
        await this.handleInvoicePaid(event);
        break;
      case 'invoice.payment_failed':
        await this.handleInvoicePaymentFailed(event);
        break;
      case 'customer.subscription.updated':
        await this.handleSubscriptionUpdated(event);
        break;
      case 'customer.subscription.deleted':
        await this.handleSubscriptionDeleted(event);
        break;
      case 'charge.refunded':
        await this.handleChargeRefunded(event);
        break;
      case 'charge.dispute.created':
        await this.handleDisputeCreated(event);
        break;
      case 'charge.dispute.closed':
        await this.handleDisputeClosed(event);
        break;
      default:
        logger.debug('未対応の Webhook イベント', {
          eventType: event.type,
        });
    }
  }

  /**
   * checkout.session.completed — Entitlement を付与
   */
  private async handleCheckoutSessionCompleted(event: Stripe.Event): Promise<void> {
    const session = event.data.object as Stripe.Checkout.Session;

    const purchaseIntentId = session.client_reference_id ||
      session.metadata?.purchase_intent_id;

    if (!purchaseIntentId) {
      throw new Error('checkout session に purchase_intent_id が未設定');
    }

    const checkoutSession = await this.checkoutSessionRepo.findByStripeSessionId(
      session.id
    );

    if (!checkoutSession) {
      throw new Error(`チェックアウトセッション未検出: ${session.id}`);
    }

    // 顧客の検索/作成
    const stripeCustomerId = typeof session.customer === 'string'
      ? session.customer
      : session.customer?.id;

    if (!stripeCustomerId) {
      throw new Error('checkout session に customer が未設定');
    }

    const customerEmail = session.customer_details?.email;
    if (!customerEmail) {
      throw new Error('checkout session に customer email が未設定');
    }

    const { customer } = await this.customerRepo.findOrCreate({
      developerId: checkoutSession.developerId,
      stripeCustomerId,
      email: customerEmail,
      name: session.customer_details?.name || undefined,
    });

    // セッションを完了に更新
    await this.checkoutSessionRepo.markComplete(checkoutSession.id, customer.id);

    // 決済情報の取得
    const paymentIntentId = typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id || '';

    const subscriptionId = typeof session.subscription === 'string'
      ? session.subscription
      : session.subscription?.id || undefined;

    // サブスクリプションの有効期限を取得
    let expiresAt: Date | null = null;
    if (subscriptionId) {
      const devStripe = await this.getStripeClientForDeveloper(checkoutSession.developerId);
      const subscription = await devStripe.getSubscription(subscriptionId);
      expiresAt = new Date(subscription.current_period_end * 1000);
    }

    // Entitlement を付与
    await this.entitlementSvc.grantEntitlement({
      customerId: customer.id,
      productId: checkoutSession.productId,
      purchaseIntentId,
      paymentId: paymentIntentId,
      subscriptionId,
      expiresAt,
    });

    logger.info('チェックアウト完了、Entitlement 付与', {
      sessionId: session.id,
      purchaseIntentId,
      customerId: customer.id,
      productId: checkoutSession.productId,
    });

    // 開発者にコールバック通知
    const product = await productRepository.findById(checkoutSession.productId);
    const eventType: CallbackEventType = subscriptionId ? 'subscription.created' : 'payment.completed';
    await this.callbackSvc.send(checkoutSession.developerId, {
      event_id: event.id,
      event_type: eventType,
      timestamp: new Date().toISOString(),
      product: product ? {
        id: product.id,
        name: product.name,
        type: product.type,
      } : undefined,
      customer: {
        email: customerEmail,
        name: session.customer_details?.name || undefined,
      },
      amount: session.amount_total ? {
        value: session.amount_total,
        currency: session.currency || 'usd',
        formatted: `${(session.amount_total / 100).toFixed(2)} ${(session.currency || 'usd').toUpperCase()}`,
      } : undefined,
      metadata: {
        purchase_intent_id: purchaseIntentId,
        session_id: session.id,
      },
    });
  }

  /**
   * invoice.paid — サブスクリプション Entitlement を更新
   */
  private async handleInvoicePaid(event: Stripe.Event): Promise<void> {
    const invoice = event.data.object as Stripe.Invoice;

    // 初回の subscription_create は checkout.session.completed で処理済み
    if (!invoice.subscription || invoice.billing_reason === 'subscription_create') {
      return;
    }

    const subscriptionId = typeof invoice.subscription === 'string'
      ? invoice.subscription
      : invoice.subscription.id;

    const entitlement = await this.entitlementSvc.getEntitlementBySubscriptionId(
      subscriptionId
    );

    if (!entitlement) {
      logger.warn('サブスクリプションに対応する Entitlement 未検出', { subscriptionId });
      return;
    }

    // 開発者ごとの Stripe クライアントで subscription を取得
    const customer = await this.customerRepo.findById(entitlement.customerId);
    const devStripe = customer
      ? await this.getStripeClientForDeveloper(customer.developerId)
      : this.stripe;
    const subscription = await devStripe.getSubscription(subscriptionId);
    const newExpiresAt = new Date(subscription.current_period_end * 1000);

    await this.entitlementSvc.renewEntitlement(entitlement.id, newExpiresAt);

    logger.info('サブスクリプション更新、Entitlement 延長', {
      subscriptionId,
      entitlementId: entitlement.id,
      newExpiresAt,
    });
  }

  /**
   * invoice.payment_failed — 決済失敗時に Entitlement を停止
   * メール通知は Stripe Dashboard の自動メール機能に委譲
   */
  private async handleInvoicePaymentFailed(event: Stripe.Event): Promise<void> {
    const invoice = event.data.object as Stripe.Invoice;

    if (!invoice.subscription) {
      return;
    }

    const subscriptionId = typeof invoice.subscription === 'string'
      ? invoice.subscription
      : invoice.subscription.id;

    const entitlement = await this.entitlementSvc.getEntitlementBySubscriptionId(
      subscriptionId
    );

    if (!entitlement) {
      logger.warn('サブスクリプションに対応する Entitlement 未検出', { subscriptionId });
      return;
    }

    logger.warn('サブスクリプション決済失敗', {
      subscriptionId,
      entitlementId: entitlement.id,
      attemptCount: invoice.attempt_count,
    });

    // 開発者ごとの Stripe クライアントで subscription ステータスを確認
    const customer = await this.customerRepo.findById(entitlement.customerId);
    const devStripe = customer
      ? await this.getStripeClientForDeveloper(customer.developerId)
      : this.stripe;
    const subscriptionData = await devStripe.getSubscription(subscriptionId);

    // past_due なら Entitlement を停止
    if (subscriptionData.status === 'past_due') {
      await this.entitlementSvc.suspendEntitlement(
        entitlement.id,
        '決済失敗、サブスクリプション延滞'
      );
    }
  }

  /**
   * customer.subscription.updated — サブスクリプション状態変更への対応
   */
  private async handleSubscriptionUpdated(event: Stripe.Event): Promise<void> {
    const subscription = event.data.object as Stripe.Subscription;

    const entitlement = await this.entitlementSvc.getEntitlementBySubscriptionId(
      subscription.id
    );

    if (!entitlement) {
      return;
    }

    if (subscription.cancel_at_period_end) {
      logger.info('サブスクリプションのキャンセル予約', {
        subscriptionId: subscription.id,
        entitlementId: entitlement.id,
        cancelAt: subscription.cancel_at
          ? new Date(subscription.cancel_at * 1000)
          : null,
      });
    }

    if (subscription.status === 'past_due') {
      await this.entitlementSvc.suspendEntitlement(
        entitlement.id,
        'サブスクリプション延滞'
      );
    } else if (subscription.status === 'active' && entitlement.status === 'suspended') {
      await this.entitlementSvc.reactivateEntitlement(entitlement.id);
    }
  }

  /**
   * customer.subscription.deleted — Entitlement を取り消し
   */
  private async handleSubscriptionDeleted(event: Stripe.Event): Promise<void> {
    const subscription = event.data.object as Stripe.Subscription;

    const entitlement = await this.entitlementSvc.getEntitlementBySubscriptionId(
      subscription.id
    );

    if (!entitlement) {
      return;
    }

    await this.entitlementSvc.revokeEntitlement(
      entitlement.id,
      'サブスクリプションキャンセル'
    );

    logger.info('サブスクリプション削除、Entitlement 取り消し', {
      subscriptionId: subscription.id,
      entitlementId: entitlement.id,
    });
  }

  /**
   * charge.refunded — 全額返金時に Entitlement を取り消し
   */
  private async handleChargeRefunded(event: Stripe.Event): Promise<void> {
    const charge = event.data.object as Stripe.Charge;

    const isFullRefund = charge.amount_refunded >= charge.amount;

    const paymentIntentId = typeof charge.payment_intent === 'string'
      ? charge.payment_intent
      : charge.payment_intent?.id;

    if (!paymentIntentId) {
      return;
    }

    const entitlement = await this.entitlementSvc.getEntitlement(paymentIntentId);

    if (!entitlement) {
      logger.warn('返金対象の Entitlement 未検出', { paymentIntentId });
      return;
    }

    if (isFullRefund) {
      await this.entitlementSvc.revokeEntitlement(
        entitlement.id,
        '全額返金処理'
      );

      logger.info('全額返金、Entitlement 取り消し', {
        paymentIntentId,
        entitlementId: entitlement.id,
        amountRefunded: charge.amount_refunded,
      });
    } else {
      logger.info('部分返金、Entitlement 維持', {
        paymentIntentId,
        entitlementId: entitlement.id,
        amountRefunded: charge.amount_refunded,
        originalAmount: charge.amount,
      });
    }
  }

  /**
   * charge.dispute.created — チャージバック発生で即座に Entitlement を取り消し
   */
  private async handleDisputeCreated(event: Stripe.Event): Promise<void> {
    const dispute = event.data.object as Stripe.Dispute;

    const paymentIntentId = typeof dispute.payment_intent === 'string'
      ? dispute.payment_intent
      : dispute.payment_intent?.id;

    if (!paymentIntentId) {
      return;
    }

    const entitlement = await this.entitlementSvc.getEntitlement(paymentIntentId);

    if (!entitlement) {
      logger.warn('チャージバック対象の Entitlement 未検出', { paymentIntentId });
      return;
    }

    await this.entitlementSvc.revokeEntitlement(
      entitlement.id,
      `チャージバック: ${dispute.reason}`
    );

    logger.warn('チャージバック発生、Entitlement 取り消し', {
      disputeId: dispute.id,
      paymentIntentId,
      entitlementId: entitlement.id,
      reason: dispute.reason,
    });
  }

  /**
   * charge.dispute.closed — チャージバック勝利時に Entitlement を復活
   */
  private async handleDisputeClosed(event: Stripe.Event): Promise<void> {
    const dispute = event.data.object as Stripe.Dispute;

    const paymentIntentId = typeof dispute.payment_intent === 'string'
      ? dispute.payment_intent
      : dispute.payment_intent?.id;

    if (!paymentIntentId) {
      return;
    }

    const entitlement = await this.entitlementSvc.getEntitlement(paymentIntentId);

    if (!entitlement) {
      return;
    }

    if (dispute.status === 'won') {
      await this.entitlementSvc.reactivateEntitlement(entitlement.id);

      logger.info('チャージバック勝利、Entitlement 復活', {
        disputeId: dispute.id,
        paymentIntentId,
        entitlementId: entitlement.id,
      });
    } else {
      logger.info('チャージバック敗北、Entitlement 取り消し維持', {
        disputeId: dispute.id,
        paymentIntentId,
        entitlementId: entitlement.id,
        status: dispute.status,
      });
    }
  }

  /**
   * 失敗した Webhook をリトライ
   */
  async retryFailedWebhook(webhookLogId: string): Promise<ProcessResult> {
    const webhookLog = await this.webhookLogRepo.findById(webhookLogId);

    if (!webhookLog) {
      return {
        success: false,
        eventId: '',
        eventType: '',
        processed: false,
        error: 'Webhook log not found',
      };
    }

    if (webhookLog.status === 'processed') {
      return {
        success: true,
        eventId: webhookLog.stripeEventId,
        eventType: webhookLog.eventType,
        processed: false,
        error: 'Already processed',
      };
    }

    const event = webhookLog.payload as unknown as Stripe.Event;

    try {
      await this.handleEvent(event);

      await this.webhookLogRepo.markProcessed(webhookLog.id);

      logger.info('Webhook リトライ成功', {
        webhookLogId,
        stripeEventId: webhookLog.stripeEventId,
        eventType: webhookLog.eventType,
      });

      return {
        success: true,
        eventId: webhookLog.stripeEventId,
        eventType: webhookLog.eventType,
        processed: true,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      const attempts = webhookLog.attempts + 1;
      if (attempts >= MAX_RETRY_ATTEMPTS) {
        await this.webhookLogRepo.moveToDLQ(webhookLog.id, errorMessage);
      } else {
        await this.webhookLogRepo.markFailed(webhookLog.id, errorMessage);
      }

      return {
        success: false,
        eventId: webhookLog.stripeEventId,
        eventType: webhookLog.eventType,
        processed: false,
        error: errorMessage,
      };
    }
  }

  /**
   * リトライ間隔を取得
   */
  getRetryInterval(attempts: number): number {
    if (attempts >= RETRY_INTERVALS.length) {
      return RETRY_INTERVALS[RETRY_INTERVALS.length - 1];
    }
    return RETRY_INTERVALS[attempts];
  }

  /**
   * リトライ可能かどうかを判定
   */
  canRetry(attempts: number): boolean {
    return attempts < MAX_RETRY_ATTEMPTS;
  }
}

// シングルトンインスタンス
export const webhookProcessor = new WebhookProcessor();
