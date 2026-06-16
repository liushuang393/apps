/**
 * @jest-environment node
 *
 * api/create-checkout-session.js の統合テスト（ForgePay 実装指南準拠）。
 * 業務フロー: purchase_intent_id での購入開始（サブスク/買い切り）、重複課金防止、入力検証、上流障害。
 */

'use strict';

const { createReq, createRes, makeForgePayFetch } = require('./helpers');
const handler = require('../../api/create-checkout-session');

describe('api/create-checkout-session', () => {
    const OLD_ENV = process.env;

    beforeEach(() => {
        process.env = {
            ...OLD_ENV,
            FORGEPAY_API_URL: 'http://localhost:3000',
            FORGEPAY_API_KEY: 'fpb_test_dummy',
            FORGEPAY_SUBSCRIPTION_PRODUCT_ID: 'sub-prod-uuid',
            FORGEPAY_ONETIME_AMOUNT: '980',
            FORGEPAY_CURRENCY: 'jpy'
        };
    });
    afterEach(() => {
        process.env = OLD_ENV;
        jest.restoreAllMocks();
    });

    test('OPTIONS は 200', async () => {
        const res = createRes();
        await handler(createReq('OPTIONS'), res);
        expect(res.statusCode).toBe(200);
    });

    test('GET は 405', async () => {
        const res = createRes();
        await handler(createReq('GET'), res);
        expect(res.statusCode).toBe(405);
    });

    test('purchase_intent_id 欠如で 400（外部呼び出しなし）', async () => {
        global.fetch = jest.fn();
        const res = createRes();
        await handler(createReq('POST', { plan: 'subscription' }), res);
        expect(res.statusCode).toBe(400);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('サブスク: 未購入なら checkout_url を返し、purchase_intent_id を引き渡す', async () => {
        global.fetch = makeForgePayFetch({
            verify: { status: 404, body: { error: { code: 'resource_not_found' } } },
            quickpay: {
                status: 201,
                body: {
                    session_id: 'cs_1',
                    checkout_url: 'https://checkout.stripe.com/c/cs_1',
                    expires_at: null
                }
            }
        });

        const res = createRes();
        await handler(
            createReq('POST', { purchase_intent_id: 'vt_order_1', plan: 'subscription' }),
            res
        );

        expect(res.statusCode).toBe(201);
        expect(res.json().checkout_url).toBe('https://checkout.stripe.com/c/cs_1');

        const quickpayCall = global.fetch.mock.calls.find((c) =>
            String(c[0]).includes('/quickpay')
        );
        const body = JSON.parse(quickpayCall[1].body);
        expect(body.purchase_intent_id).toBe('vt_order_1');
        expect(body.product_id).toBe('sub-prod-uuid');
        expect(body.metadata.plan).toBe('subscription');
    });

    test('買い切り: 商品未設定ならアドホック金額で checkout を作る', async () => {
        global.fetch = makeForgePayFetch({
            verify: { status: 404, body: {} },
            quickpay: {
                status: 201,
                body: { session_id: 'cs_2', checkout_url: 'https://x2', expires_at: null }
            }
        });
        const res = createRes();
        await handler(
            createReq('POST', { purchase_intent_id: 'vt_order_2', plan: 'onetime' }),
            res
        );
        expect(res.statusCode).toBe(201);
        const quickpayCall = global.fetch.mock.calls.find((c) =>
            String(c[0]).includes('/quickpay')
        );
        const body = JSON.parse(quickpayCall[1].body);
        expect(body.amount).toBe(980);
        expect(body.currency).toBe('jpy');
        expect(body.name).toBeDefined();
    });

    test('重複課金防止: 既に active なら 409 で quickpay を呼ばない', async () => {
        global.fetch = makeForgePayFetch({
            verify: {
                status: 200,
                body: { status: 'active', has_access: true, product_id: 'sub-prod-uuid' }
            }
        });
        const res = createRes();
        await handler(
            createReq('POST', { purchase_intent_id: 'vt_paid', plan: 'subscription' }),
            res
        );
        expect(res.statusCode).toBe(409);
        expect(res.json().isActive).toBe(true);
        const quickpayCalls = global.fetch.mock.calls.filter((c) =>
            String(c[0]).includes('/quickpay')
        );
        expect(quickpayCalls.length).toBe(0);
    });

    test('上流(quickpay)が 500 なら 502', async () => {
        global.fetch = makeForgePayFetch({
            verify: { status: 404, body: {} },
            quickpay: { status: 500, body: { error: { code: 'internal_error', message: 'boom' } } }
        });
        const res = createRes();
        await handler(createReq('POST', { purchase_intent_id: 'vt_3', plan: 'subscription' }), res);
        expect(res.statusCode).toBe(502);
    });

    test('サブスク商品未設定なら設定エラー 500', async () => {
        delete process.env.FORGEPAY_SUBSCRIPTION_PRODUCT_ID;
        global.fetch = makeForgePayFetch({ verify: { status: 404, body: {} } });
        const res = createRes();
        await handler(createReq('POST', { purchase_intent_id: 'vt_4', plan: 'subscription' }), res);
        expect(res.statusCode).toBe(500);
        expect(res.json().error).toBe('product_not_configured');
    });
});
