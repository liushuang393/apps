import { pool } from '../config/database';
import {
  CheckoutSessionRepository,
  checkoutSessionRepository,
  CheckoutSession,
  CreateCheckoutSessionParams,
} from '../repositories/CheckoutSessionRepository';
import {
  ProductRepository,
  productRepository,
} from '../repositories/ProductRepository';
import {
  PriceRepository,
  priceRepository,
} from '../repositories/PriceRepository';
import {
  StripeClient,
  CreateCheckoutSessionParams as StripeCheckoutParams,
} from './StripeClient';
import { StripeClientFactory, stripeClientFactory } from './StripeClientFactory';
import { DeveloperRepository, developerRepository } from '../repositories/DeveloperRepository';
import { logger } from '../utils/logger';

/**
 * チェックアウトセッション作成パラメータ
 * 通貨・税金・クーポンは Stripe に委譲するためシンプルな構成
 */
export interface CreateSessionParams {
  developerId: string;
  productId: string;
  priceId: string;
  purchaseIntentId: string;
  customerEmail?: string;
  successUrl: string;
  cancelUrl: string;
  metadata?: Record<string, string>;
  /** Checkout 画面の表示言語（開発者設定のデフォルト or リクエスト個別指定）*/
  locale?: string;
  /** 通貨コード（ISO 4217: jpy, usd, eur 等）*/
  currency?: string;
  /** 決済方法リスト（card, konbini, alipay, wechat_pay 等）*/
  paymentMethods?: string[];
}

/**
 * チェックアウトセッション作成結果
 */
export interface CreateSessionResult {
  sessionId: string;
  checkoutUrl: string;
  expiresAt: Date;
}

/**
 * CheckoutService — OpenAI purchase_intent_id と Stripe Checkout Session のマッピング
 *
 * 薄いレイヤーとして以下のみを担当:
 * - purchase_intent_id を含む Stripe Checkout Session の作成
 * - セッションメタデータの DB 保存
 * - セッションライフサイクル管理
 *
 * 通貨変換・クーポン・税金計算は全て Stripe に委譲
 */
export class CheckoutService {
  private checkoutSessionRepo: CheckoutSessionRepository;
  private productRepo: ProductRepository;
  private priceRepo: PriceRepository;
  private stripeFactory: StripeClientFactory;
  private developerRepo: DeveloperRepository;

  constructor(
    checkoutSessionRepo: CheckoutSessionRepository = checkoutSessionRepository,
    productRepo: ProductRepository = productRepository,
    priceRepo: PriceRepository = priceRepository,
    stripeFactory: StripeClientFactory = stripeClientFactory,
    devRepo: DeveloperRepository = developerRepository
  ) {
    this.checkoutSessionRepo = checkoutSessionRepo;
    this.productRepo = productRepo;
    this.priceRepo = priceRepo;
    this.stripeFactory = stripeFactory;
    this.developerRepo = devRepo;
  }

  /**
   * 開発者IDからStripeクライアントを取得（マルチテナント対応）
   */
  private async getStripeClient(developerId: string): Promise<StripeClient> {
    const developer = await this.developerRepo.findById(developerId);
    return this.stripeFactory.getClient(
      developer?.stripeSecretKeyEnc || null,
      developerId
    );
  }

  /**
   * チェックアウトセッションを作成
   *
   * purchase_intent_id を Stripe session の client_reference_id にマッピングし、
   * DB に保存する。通貨・税金は Stripe が自動処理。
   */
  async createSession(params: CreateSessionParams): Promise<CreateSessionResult> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // 商品の存在と有効性を検証
      const product = await this.productRepo.findById(params.productId, client);
      if (!product) {
        throw new Error('Product not found');
      }
      if (!product.active) {
        throw new Error('Product is not active');
      }

      // 価格の存在と有効性を検証
      const price = await this.priceRepo.findById(params.priceId, client);
      if (!price) {
        throw new Error('Price not found');
      }
      if (!price.active) {
        throw new Error('Price is not active');
      }
      if (price.productId !== params.productId) {
        throw new Error('Price does not belong to the specified product');
      }

      // 冪等性: 同じ purchase_intent_id のセッションが既に存在するか確認
      const existingSession = await this.checkoutSessionRepo.findByPurchaseIntentId(
        params.purchaseIntentId,
        client
      );

      if (existingSession && existingSession.status === 'open') {
        await client.query('COMMIT');
        return {
          sessionId: existingSession.id,
          checkoutUrl: `https://checkout.stripe.com/c/pay/${existingSession.stripeSessionId}`,
          expiresAt: existingSession.expiresAt,
        };
      }

      // Stripe Checkout Session を作成
      const mode = product.type === 'subscription' ? 'subscription' : 'payment';

      // 開発者のデフォルト設定を取得
      const developer = await this.developerRepo.findById(params.developerId);

      const stripeParams: StripeCheckoutParams = {
        productId: params.productId,
        priceId: price.stripePriceId,
        purchaseIntentId: params.purchaseIntentId,
        customerEmail: params.customerEmail,
        successUrl: params.successUrl,
        cancelUrl: params.cancelUrl,
        mode,
        metadata: params.metadata,
        // ロケール: リクエスト指定 → 開発者デフォルト → 'auto'
        locale: (params.locale ?? developer?.defaultLocale ?? 'auto') as import('./StripeClient').CheckoutLocale,
        // 決済方法: リクエスト指定 → 開発者デフォルト → undefined（Stripe デフォルト）
        paymentMethodTypes: (params.paymentMethods ?? developer?.defaultPaymentMethods) as import('./StripeClient').PaymentMethodType[] | undefined,
      };

      const stripe = await this.getStripeClient(params.developerId);
      const stripeSession = await stripe.createCheckoutSession(stripeParams);

      // DB にセッション情報を保存
      const createParams: CreateCheckoutSessionParams = {
        developerId: params.developerId,
        stripeSessionId: stripeSession.sessionId,
        purchaseIntentId: params.purchaseIntentId,
        productId: params.productId,
        priceId: params.priceId,
        status: 'open',
        successUrl: params.successUrl,
        cancelUrl: params.cancelUrl,
        expiresAt: stripeSession.expiresAt,
      };

      const session = await this.checkoutSessionRepo.create(createParams, client);

      await client.query('COMMIT');

      logger.info('チェックアウトセッション作成', {
        sessionId: session.id,
        stripeSessionId: stripeSession.sessionId,
        purchaseIntentId: params.purchaseIntentId,
        productId: params.productId,
      });

      return {
        sessionId: session.id,
        checkoutUrl: stripeSession.url,
        expiresAt: stripeSession.expiresAt,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('チェックアウトセッション作成エラー', {
        error,
        params: { ...params, customerEmail: '***' },
      });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * セッションIDでチェックアウトセッションを取得
   */
  async getSession(sessionId: string): Promise<CheckoutSession | null> {
    return this.checkoutSessionRepo.findById(sessionId);
  }

  /**
   * Stripe セッションIDでチェックアウトセッションを取得
   */
  async getSessionByStripeId(
    stripeSessionId: string
  ): Promise<CheckoutSession | null> {
    return this.checkoutSessionRepo.findByStripeSessionId(stripeSessionId);
  }

  /**
   * purchase_intent_id でチェックアウトセッションを取得
   */
  async getSessionByPurchaseIntentId(
    purchaseIntentId: string
  ): Promise<CheckoutSession | null> {
    return this.checkoutSessionRepo.findByPurchaseIntentId(purchaseIntentId);
  }

  /**
   * セッションを完了済みに更新
   */
  async markSessionComplete(
    sessionId: string,
    customerId?: string
  ): Promise<CheckoutSession | null> {
    const session = await this.checkoutSessionRepo.markComplete(
      sessionId,
      customerId
    );

    if (session) {
      logger.info('チェックアウトセッション完了', {
        sessionId: session.id,
        customerId,
      });
    }

    return session;
  }

  /**
   * セッションを期限切れに更新
   */
  async markSessionExpired(sessionId: string): Promise<CheckoutSession | null> {
    const session = await this.checkoutSessionRepo.markExpired(sessionId);

    if (session) {
      logger.info('チェックアウトセッション期限切れ', {
        sessionId: session.id,
      });
    }

    return session;
  }

  /**
   * セッションを期限切れにする（Stripe 側も含む）
   */
  async expireSession(sessionId: string): Promise<CheckoutSession | null> {
    const session = await this.checkoutSessionRepo.findById(sessionId);

    if (!session) {
      return null;
    }

    const stripe = await this.getStripeClient(session.developerId);
    try {
      await stripe.expireCheckoutSession(session.stripeSessionId);
    } catch (error) {
      logger.warn('Stripe セッション期限切れ処理失敗', {
        error,
        stripeSessionId: session.stripeSessionId,
      });
    }

    return this.markSessionExpired(sessionId);
  }

  /**
   * 期限切れセッションのクリーンアップ
   */
  async processExpiredSessions(): Promise<number> {
    const expiredSessions = await this.checkoutSessionRepo.findExpiredSessions();

    let count = 0;
    for (const session of expiredSessions) {
      try {
        await this.markSessionExpired(session.id);
        count++;
      } catch (error) {
        logger.error('セッション期限切れ処理エラー', {
          error,
          sessionId: session.id,
        });
      }
    }

    if (count > 0) {
      logger.info('期限切れセッション処理完了', { count });
    }

    return count;
  }

  /**
   * 開発者のチェックアウトセッション一覧を取得
   */
  async getSessionsByDeveloper(
    developerId: string,
    status?: 'open' | 'complete' | 'expired',
    limit: number = 100
  ): Promise<CheckoutSession[]> {
    return this.checkoutSessionRepo.findByDeveloperId(developerId, status, limit);
  }
}

// シングルトンインスタンス
export const checkoutService = new CheckoutService();
