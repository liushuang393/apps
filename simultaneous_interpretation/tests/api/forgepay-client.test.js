/**
 * @jest-environment node
 *
 * api/_forgepay.js のユニットテスト（ForgePay REST クライアント）。
 * global.fetch をモックして外部通信を遮断する。
 */

'use strict';

const { fetchResponse } = require('./helpers');
const forgepay = require('../../api/_forgepay');

describe('api/_forgepay', () => {
    const OLD_ENV = process.env;

    beforeEach(() => {
        process.env = {
            ...OLD_ENV,
            FORGEPAY_API_URL: 'http://localhost:3000',
            FORGEPAY_API_KEY: 'fpb_test_dummy'
        };
        global.fetch = jest.fn();
    });

    afterEach(() => {
        process.env = OLD_ENV;
        jest.restoreAllMocks();
    });

    describe('getApiKey', () => {
        test('FORGEPAY_API_KEY 未設定なら例外', () => {
            delete process.env.FORGEPAY_API_KEY;
            expect(() => forgepay._getApiKey()).toThrow(/FORGEPAY_API_KEY/);
        });
    });

    describe('createPayment', () => {
        test('成功時に session/checkout を返し、正しいリクエストを送る', async () => {
            global.fetch.mockResolvedValue(
                fetchResponse(201, {
                    session_id: 'cs_test_1',
                    checkout_url: 'https://checkout.stripe.com/c/pay/cs_test_1',
                    expires_at: '2026-06-16T02:00:00Z'
                })
            );

            const result = await forgepay.createPayment({
                purchaseIntentId: 'user_1',
                productId: 'prod-uuid',
                metadata: { plan: 'subscription' }
            });

            expect(result).toEqual({
                sessionId: 'cs_test_1',
                checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_1',
                expiresAt: '2026-06-16T02:00:00Z'
            });

            const [url, init] = global.fetch.mock.calls[0];
            expect(url).toBe('http://localhost:3000/api/v1/quickpay');
            expect(init.method).toBe('POST');
            expect(init.headers['X-API-Key']).toBe('fpb_test_dummy');
            const body = JSON.parse(init.body);
            expect(body.purchase_intent_id).toBe('user_1');
            expect(body.product_id).toBe('prod-uuid');
        });

        test('purchaseIntentId 欠如で ForgePayError(400)', async () => {
            await expect(forgepay.createPayment({})).rejects.toMatchObject({
                name: 'ForgePayError',
                status: 400
            });
        });

        test('ForgePay が 4xx を返すと ForgePayError に変換', async () => {
            global.fetch.mockResolvedValue(
                fetchResponse(404, { error: { code: 'product_not_found', message: 'no product' } })
            );
            await expect(
                forgepay.createPayment({ purchaseIntentId: 'u', productId: 'x' })
            ).rejects.toMatchObject({
                name: 'ForgePayError',
                status: 404,
                code: 'product_not_found'
            });
        });

        test('ネットワーク不通は 502 の ForgePayError', async () => {
            global.fetch.mockRejectedValue(new Error('ECONNREFUSED'));
            await expect(
                forgepay.createPayment({ purchaseIntentId: 'u', productId: 'x' })
            ).rejects.toMatchObject({ name: 'ForgePayError', status: 502 });
        });
    });

    describe('verifyEntitlement', () => {
        test('200 has_access=true で active=true', async () => {
            global.fetch.mockResolvedValue(
                fetchResponse(200, {
                    status: 'active',
                    has_access: true,
                    product_id: 'prod-uuid',
                    entitlement_id: 'ent_1',
                    expires_at: null
                })
            );
            const result = await forgepay.verifyEntitlement('user_1');
            expect(result.active).toBe(true);
            expect(result.status).toBe('active');
            expect(result.productId).toBe('prod-uuid');
        });

        test('404 は未購入として active=false', async () => {
            global.fetch.mockResolvedValue(
                fetchResponse(404, { error: { code: 'resource_not_found' } })
            );
            const result = await forgepay.verifyEntitlement('user_1');
            expect(result.active).toBe(false);
            expect(result.status).toBe('none');
        });

        test('500 は ForgePayError', async () => {
            global.fetch.mockResolvedValue(
                fetchResponse(500, { error: { code: 'internal_error' } })
            );
            await expect(forgepay.verifyEntitlement('user_1')).rejects.toMatchObject({
                name: 'ForgePayError'
            });
        });
    });
});
