import Stripe from 'stripe';
import { pool } from '../config/database';
import { ProductRepository, productRepository } from '../repositories/ProductRepository';
import { PriceRepository, priceRepository } from '../repositories/PriceRepository';
import { CustomerRepository, customerRepository } from '../repositories/CustomerRepository';
import { DeveloperRepository, developerRepository } from '../repositories/DeveloperRepository';
import { StripeClient } from './StripeClient';
import { StripeClientFactory, stripeClientFactory } from './StripeClientFactory';
import { logger } from '../utils/logger';

/**
 * サブスクリプション作成パラメータ（方案3: PaymentIntent API）
 */
export interface CreateSubscriptionParams {
    developerId: string;
    productId: string;
    priceId: string;
    purchaseIntentId?: string;
    customerEmail: string;
    customerName?: string;
    paymentMethodId?: string;
    trialPeriodDays?: number;
    metadata?: Record<string, string>;
}

/**
 * サブスクリプション作成結果
 */
export interface CreateSubscriptionResult {
    subscriptionId: string;
    status: string;
    clientSecret: string | null;
    currentPeriodEnd: Date;
    cancelAtPeriodEnd: boolean;
    publishableKey: string;
}

/**
 * SetupIntent 作成結果（カード登録用）
 */
export interface CreateSetupIntentResult {
    setupIntentId: string;
    clientSecret: string;
    customerId: string;
    publishableKey: string;
}

/**
 * サブスクリプション更新パラメータ
 */
export interface UpdateSubscriptionParams {
    newPriceId: string;
    prorationBehavior?: 'create_prorations' | 'none' | 'always_invoice';
}

/**
 * SubscriptionService — 方案3 (PaymentIntent API) 用サービス
 *
 * 役割:
 * - SetupIntent によるカード登録（課金なし）
 * - サブスクリプションの作成・更新・キャンセル
 * - アップグレード/ダウングレード（日割り計算付き）
 * - Entitlement との連携
 *
 * セキュリティ:
 * - カード番号はサーバーを通過しない（PCI SAQ A 準拠）
 * - SetupIntent / PaymentIntent の client_secret のみ返す
 * - 全リクエストは API キー認証済み
 */
export class SubscriptionService {
    private productRepo: ProductRepository;
    private priceRepo: PriceRepository;
    private customerRepo: CustomerRepository;
    private developerRepo: DeveloperRepository;
    private stripeFactory: StripeClientFactory;

    constructor(
        productRepo: ProductRepository = productRepository,
        priceRepo: PriceRepository = priceRepository,
        customerRepo: CustomerRepository = customerRepository,
        developerRepo: DeveloperRepository = developerRepository,
        stripeFactory: StripeClientFactory = stripeClientFactory
    ) {
        this.productRepo = productRepo;
        this.priceRepo = priceRepo;
        this.customerRepo = customerRepo;
        this.developerRepo = developerRepo;
        this.stripeFactory = stripeFactory;
    }

    private async getStripeClient(developerId: string): Promise<StripeClient> {
        const developer = await this.developerRepo.findById(developerId);
        return this.stripeFactory.getClient(
            developer?.stripeSecretKeyEnc || null,
            developerId
        );
    }

    /**
     * SetupIntent を作成（カード登録のみ、課金なし）
     *
     * フロー:
     * 1. 顧客を Stripe に作成（または検索）
     * 2. SetupIntent を作成して client_secret を返す
     * 3. フロントエンドで stripe.confirmSetupIntent() を呼び出す
     * 4. 登録された paymentMethodId で createSubscription() を呼ぶ
     */
    async createSetupIntent(
        developerId: string,
        customerEmail: string,
        customerName?: string
    ): Promise<CreateSetupIntentResult> {
        const stripe = await this.getStripeClient(developerId);
        const developer = await this.developerRepo.findById(developerId);

        // Stripe 顧客を検索または作成
        const stripeCustomer = await stripe.findOrCreateCustomer(
            customerEmail,
            customerName,
            { developer_id: developerId }
        );

        // ローカル DB に顧客を記録
        await this.customerRepo.findOrCreate({
            developerId,
            stripeCustomerId: stripeCustomer.id,
            email: customerEmail,
            name: customerName,
        });

        // SetupIntent を作成
        const setupIntent = await stripe.createSetupIntent({
            customerId: stripeCustomer.id,
            metadata: { developer_id: developerId },
        });

        logger.info('SetupIntent 作成（サブスクリプション用カード登録）', {
            setupIntentId: setupIntent.id,
            customerId: stripeCustomer.id,
            developerId,
        });

        return {
            setupIntentId: setupIntent.id,
            clientSecret: setupIntent.client_secret!,
            customerId: stripeCustomer.id,
            publishableKey: developer?.stripePublishableKey || '',
        };
    }

    /**
     * サブスクリプションを作成
     *
     * フロー:
     * 1. 商品・価格の検証
     * 2. Stripe 顧客を検索または作成
     * 3. stripe.subscriptions.create() を呼び出す
     * 4. latest_invoice.payment_intent.client_secret を返す
     * 5. フロントエンドで stripe.confirmPayment() を呼び出す
     * 6. Webhook (invoice.paid) で Entitlement を付与
     */
    async createSubscription(
        params: CreateSubscriptionParams
    ): Promise<CreateSubscriptionResult> {
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            // 商品の検証
            const product = await this.productRepo.findById(params.productId, client);
            if (!product) throw new Error('Product not found');
            if (!product.active) throw new Error('Product is not active');
            if (product.type !== 'subscription') {
                throw new Error(
                    'One-time payment products should use POST /payment-intents instead.'
                );
            }

            // 価格の検証
            const price = await this.priceRepo.findById(params.priceId, client);
            if (!price) throw new Error('Price not found');
            if (!price.active) throw new Error('Price is not active');
            if (price.productId !== params.productId) {
                throw new Error('Price does not belong to the specified product');
            }

            const stripe = await this.getStripeClient(params.developerId);
            const developer = await this.developerRepo.findById(params.developerId);

            // Stripe 顧客を検索または作成
            const stripeCustomer = await stripe.findOrCreateCustomer(
                params.customerEmail,
                params.customerName,
                { developer_id: params.developerId }
            );

            // ローカル DB に顧客を記録
            await this.customerRepo.findOrCreate({
                developerId: params.developerId,
                stripeCustomerId: stripeCustomer.id,
                email: params.customerEmail,
                name: params.customerName,
            });

            // サブスクリプションのメタデータ
            const subMetadata: Record<string, string> = {
                product_id: params.productId,
                price_id: params.priceId,
                developer_id: params.developerId,
                ...(params.purchaseIntentId ? { purchase_intent_id: params.purchaseIntentId } : {}),
                ...params.metadata,
            };

            // サブスクリプションを作成
            const subscription = await stripe.createSubscription({
                customerId: stripeCustomer.id,
                priceId: price.stripePriceId,
                paymentMethodId: params.paymentMethodId,
                trialPeriodDays: params.trialPeriodDays,
                metadata: subMetadata,
            });

            await client.query('COMMIT');

            // latest_invoice.payment_intent から client_secret を取得
            const latestInvoice = subscription.latest_invoice as Stripe.Invoice | null;
            const paymentIntent = latestInvoice?.payment_intent as Stripe.PaymentIntent | null;
            const clientSecret = paymentIntent?.client_secret || null;

            logger.info('サブスクリプション作成（PaymentIntent 方式）', {
                subscriptionId: subscription.id,
                customerId: stripeCustomer.id,
                priceId: price.stripePriceId,
                status: subscription.status,
                developerId: params.developerId,
            });

            return {
                subscriptionId: subscription.id,
                status: subscription.status,
                clientSecret,
                currentPeriodEnd: new Date(subscription.current_period_end * 1000),
                cancelAtPeriodEnd: subscription.cancel_at_period_end,
                publishableKey: developer?.stripePublishableKey || '',
            };
        } catch (error) {
            await client.query('ROLLBACK');
            logger.error('サブスクリプション作成エラー', { error, params });
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * サブスクリプションを取得
     */
    async getSubscription(
        developerId: string,
        subscriptionId: string
    ): Promise<Stripe.Subscription> {
        const stripe = await this.getStripeClient(developerId);
        return stripe.getSubscription(subscriptionId);
    }

    /**
     * サブスクリプションをアップグレード/ダウングレード
     *
     * 日割り計算（proration）付きでプランを変更する。
     * Webhook (customer.subscription.updated) で Entitlement を更新。
     */
    async updateSubscription(
        developerId: string,
        subscriptionId: string,
        params: UpdateSubscriptionParams
    ): Promise<Stripe.Subscription> {
        // 新しい価格の検証
        const newPrice = await this.priceRepo.findById(params.newPriceId);
        if (!newPrice) throw new Error('New price not found');
        if (!newPrice.active) throw new Error('New price is not active');

        const stripe = await this.getStripeClient(developerId);

        const updated = await stripe.updateSubscription(subscriptionId, {
            newPriceId: newPrice.stripePriceId,
            prorationBehavior: params.prorationBehavior || 'create_prorations',
        });

        logger.info('サブスクリプション更新（プラン変更）', {
            subscriptionId: updated.id,
            newPriceId: params.newPriceId,
            prorationBehavior: params.prorationBehavior,
            developerId,
        });

        return updated;
    }

    /**
     * サブスクリプションをキャンセル
     *
     * immediately=false（デフォルト）: 現在の請求期間終了時にキャンセル
     * immediately=true: 即座にキャンセル（返金は別途処理）
     */
    async cancelSubscription(
        developerId: string,
        subscriptionId: string,
        immediately: boolean = false
    ): Promise<Stripe.Subscription> {
        const stripe = await this.getStripeClient(developerId);
        const subscription = await stripe.cancelSubscription(subscriptionId, immediately);

        logger.info('サブスクリプションキャンセル', {
            subscriptionId: subscription.id,
            immediately,
            cancelAtPeriodEnd: subscription.cancel_at_period_end,
            developerId,
        });

        return subscription;
    }
}

export const subscriptionService = new SubscriptionService();
