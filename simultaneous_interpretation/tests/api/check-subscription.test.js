/**
 * @jest-environment node
 *
 * api/check-subscription.js の統合テスト（ForgePay 実装指南準拠）。
 * purchase_intent_id と unlock_token の 2 通りで照会できることを検証。
 */

'use strict';

const { createReq, createRes, makeForgePayFetch } = require('./helpers');
const handler = require('../../api/check-subscription');

describe('api/check-subscription', () => {
    const OLD_ENV = process.env;

    beforeEach(() => {
        process.env = {
            ...OLD_ENV,
            FORGEPAY_API_URL: 'http://localhost:3000',
            FORGEPAY_API_KEY: 'fpb_test_dummy'
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

    test('キー無しは 400', async () => {
        global.fetch = jest.fn();
        const res = createRes();
        await handler(createReq('POST', {}), res);
        expect(res.statusCode).toBe(400);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('purchase_intent_id が active で isActive=true', async () => {
        global.fetch = makeForgePayFetch({
            verify: {
                status: 200,
                body: {
                    status: 'active',
                    has_access: true,
                    product_id: 'p',
                    expires_at: '2026-07-01T00:00:00Z'
                }
            }
        });
        const res = createRes();
        await handler(createReq('POST', { purchase_intent_id: 'vt_1' }), res);
        expect(res.statusCode).toBe(200);
        expect(res.json()).toMatchObject({
            isActive: true,
            status: 'active',
            expiresAt: '2026-07-01T00:00:00Z'
        });
    });

    test('未購入(404)で isActive=false', async () => {
        global.fetch = makeForgePayFetch({
            verify: { status: 404, body: { error: { code: 'resource_not_found' } } }
        });
        const res = createRes();
        await handler(createReq('POST', { purchase_intent_id: 'vt_2' }), res);
        expect(res.statusCode).toBe(200);
        expect(res.json().isActive).toBe(false);
    });

    test('unlock_token が有効で isActive=true（unlock_token で照会）', async () => {
        global.fetch = makeForgePayFetch({
            verify: {
                status: 200,
                body: { status: 'active', has_access: true, product_id: 'p', expires_at: null }
            }
        });
        const res = createRes();
        await handler(createReq('POST', { unlock_token: 'jwt.unlock.token' }), res);
        expect(res.statusCode).toBe(200);
        expect(res.json().isActive).toBe(true);
        const call = global.fetch.mock.calls.find((c) => String(c[0]).includes('unlock_token='));
        expect(call).toBeDefined();
    });

    test('unlock_token が無効(401)なら isActive=false', async () => {
        global.fetch = makeForgePayFetch({
            verify: { status: 401, body: { error: { code: 'invalid_token' } } }
        });
        const res = createRes();
        await handler(createReq('POST', { unlock_token: 'expired' }), res);
        expect(res.statusCode).toBe(200);
        expect(res.json().isActive).toBe(false);
    });
});
