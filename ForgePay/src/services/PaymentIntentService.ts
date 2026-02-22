import { pool } from '../config/database';
import { ProductRepository, productRepository } from '../repositories/ProductRepository';
import { PriceRepository, priceRepository } from '../repositories/PriceRepository';
import { CustomerRepository, customerRepository } from '../repositories/CustomerRepository';
import { DeveloperRepository, developerRepository } from '../repositories/DeveloperRepository';
import { StripeClient } from './StripeClient';
import { StripeClientFactory, stripeClientFactory } from './StripeClientFactory';
import { logger } from '../utils/logger';

/**
 * PaymentIntent 作成パラメータ（方案2: Stripe Elements 用）
 */
export interface CreatePaymentIntentParams {
    developerId: string;
    productId: string;
    priceId: string;
    purchaseIntentId?: string;
    customerEmail?: string;
    metadata?: Record<string, string>;
}

/**
 * PaymentIntent 作成結果
 */
export interface CreatePaymentIntentResult {
    paymentIntentId: string;
    clientSecret: string;
    amount: number;
    currency: string;
    publishableKey: string;
}

/**
 * PaymentIntentService — 方案2 (Stripe Elements) 用サービス
 *
 * 役割:
 * - 商品・価格の検証
 * - Stripe PaymentIntent の作成
 * - client_secret をフロントエンドに返す（カード情報はフロントで直接 Stripe に送信）
 *
 * セキュリティ:
 * - カード番号はサーバーを通過しない（PCI SAQ A 準拠）
 * - client_secret は短命（Stripe 側で管理）
 * - 全リクエストは API キー認証済み
 */
export class PaymentIntentService {
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
     * PaymentIntent を作成し client_secret を返す
     *
     * フロントエンドはこの client_secret を使って
     * stripe.confirmPayment() を呼び出す。
     * カード情報はサーバーを経由しない（PCI SAQ A 準拠）。
     */
    async createPaymentIntent(
        params: CreatePaymentIntentParams
    ): Promise<CreatePaymentIntentResult> {
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            // 商品の検証
            const product = await this.productRepo.findById(params.productId, client);
            if (!product) throw new Error('Product not found');
            if (!product.active) throw new Error('Product is not active');

            // 価格の検証
            const price = await this.priceRepo.findById(params.priceId, client);
            if (!price) throw new Error('Price not found');
            if (!price.active) throw new Error('Price is not active');
            if (price.productId !== params.productId) {
                throw new Error('Price does not belong to the specified product');
            }

            // サブスクリプション商品は方案3（SubscriptionService）を使用
            if (product.type === 'subscription') {
                throw new Error(
                    'Subscription products require payment-intent mode. Use POST /subscriptions instead.'
                );
            }

            const stripe = await this.getStripeClient(params.developerId);
            const developer = await this.developerRepo.findById(params.developerId);

            // Stripe 顧客の検索または作成
            let stripeCustomerId: string | undefined;
            if (params.customerEmail) {
                const stripeCustomer = await stripe.findOrCreateCustomer(
                    params.customerEmail,
                    undefined,
                    { developer_id: params.developerId }
                );
                stripeCustomerId = stripeCustomer.id;

                // ローカル DB にも顧客を記録
                await this.customerRepo.findOrCreate({
                    developerId: params.developerId,
                    stripeCustomerId,
                    email: params.customerEmail,
                });
            }

            // PaymentIntent を作成（StripeClient の新メソッドを使用）
            const intentMetadata: Record<string, string> = {
                product_id: params.productId,
                price_id: params.priceId,
                developer_id: params.developerId,
                ...(params.purchaseIntentId ? { purchase_intent_id: params.purchaseIntentId } : {}),
                ...params.metadata,
            };

            const paymentIntent = await stripe.createPaymentIntent({
                amount: price.amount,         // Price.amount（センター単位）
                currency: price.currency,
                customerId: stripeCustomerId,
                receiptEmail: params.customerEmail,
                metadata: intentMetadata,
                automaticPaymentMethods: true,
            });

            await client.query('COMMIT');

            logger.info('PaymentIntent 作成（Elements 方式）', {
                paymentIntentId: paymentIntent.id,
                amount: paymentIntent.amount,
                currency: paymentIntent.currency,
                developerId: params.developerId,
            });

            return {
                paymentIntentId: paymentIntent.id,
                clientSecret: paymentIntent.client_secret!,
                amount: paymentIntent.amount,
                currency: paymentIntent.currency,
                publishableKey: developer?.stripePublishableKey || '',
            };
        } catch (error) {
            await client.query('ROLLBACK');
            logger.error('PaymentIntent 作成エラー', { error, params });
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * PaymentIntent のステータスを取得
     */
    async getPaymentIntentStatus(
        developerId: string,
        paymentIntentId: string
    ): Promise<{ id: string; status: string; amount: number; currency: string }> {
        const stripe = await this.getStripeClient(developerId);
        const pi = await stripe.getPaymentIntent(paymentIntentId);

        return {
            id: pi.id,
            status: pi.status,
            amount: pi.amount,
            currency: pi.currency,
        };
    }
}

export const paymentIntentService = new PaymentIntentService();
