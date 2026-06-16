/**
 * @jest-environment node
 *
 * api/forgepay-callback.js の統合テスト（ForgePay 実装指南 §7 準拠の HMAC 署名検証）。
 */

'use strict';

const crypto = require('crypto');
const { createRes } = require('./helpers');
const handler = require('../../api/forgepay-callback');

const SECRET = 'whsec_test_callback_secret';

/**
 * 署名付きのモックリクエストを作る。
 * @param {object} payload
 * @param {{timestamp?:string, secret?:string, tamper?:boolean}} [opts]
 */
function signedReq(payload, opts = {}) {
    const rawBody = JSON.stringify(payload);
    const timestamp = opts.timestamp || new Date().toISOString();
    const secret = opts.secret || SECRET;
    let sig =
        'sha256=' +
        crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
    if (opts.tamper) {
        sig = 'sha256=deadbeef';
    }
    return {
        method: 'POST',
        headers: { 'x-forgepay-timestamp': timestamp, 'x-forgepay-signature': sig },
        rawBody
    };
}

describe('api/forgepay-callback', () => {
    const OLD_ENV = process.env;

    beforeEach(() => {
        process.env = { ...OLD_ENV, FORGEPAY_CALLBACK_SECRET: SECRET };
        handler._reset();
    });
    afterEach(() => {
        process.env = OLD_ENV;
    });

    test('非 POST は 405', async () => {
        const res = createRes();
        await handler({ method: 'GET', headers: {} }, res);
        expect(res.statusCode).toBe(405);
    });

    test('正しい署名の payment.completed は 200', async () => {
        const res = createRes();
        await handler(
            signedReq({
                event_id: 'evt_1',
                event_type: 'payment.completed',
                metadata: { purchase_intent_id: 'vt_1' }
            }),
            res
        );
        expect(res.statusCode).toBe(200);
        expect(res.json().received).toBe(true);
    });

    test('署名ヘッダが無いと 401', async () => {
        const res = createRes();
        await handler({ method: 'POST', headers: {}, rawBody: '{}' }, res);
        expect(res.statusCode).toBe(401);
    });

    test('署名が一致しないと 401', async () => {
        const res = createRes();
        await handler(
            signedReq(
                { event_id: 'evt_2', event_type: 'payment.completed', metadata: {} },
                { tamper: true }
            ),
            res
        );
        expect(res.statusCode).toBe(401);
    });

    test('古い timestamp は 401（リプレイ防止）', async () => {
        const res = createRes();
        const old = new Date(Date.now() - 10 * 60 * 1000).toISOString();
        await handler(
            signedReq(
                {
                    event_id: 'evt_3',
                    event_type: 'payment.completed',
                    metadata: { purchase_intent_id: 'x' }
                },
                { timestamp: old }
            ),
            res
        );
        expect(res.statusCode).toBe(401);
    });

    test('refund.completed は 200', async () => {
        const res = createRes();
        await handler(
            signedReq({
                event_id: 'evt_4',
                event_type: 'refund.completed',
                metadata: { purchase_intent_id: 'vt_1' }
            }),
            res
        );
        expect(res.statusCode).toBe(200);
    });

    test('同一 event_id は冪等（2回目は duplicate）', async () => {
        const payload = {
            event_id: 'evt_dup',
            event_type: 'payment.completed',
            metadata: { purchase_intent_id: 'vt_1' }
        };
        const res1 = createRes();
        await handler(signedReq(payload), res1);
        expect(res1.json().received).toBe(true);

        const res2 = createRes();
        await handler(signedReq(payload), res2);
        expect(res2.statusCode).toBe(200);
        expect(res2.json().duplicate).toBe(true);
    });

    test('シークレット未設定なら 401（fail-closed）', async () => {
        delete process.env.FORGEPAY_CALLBACK_SECRET;
        const res = createRes();
        await handler(
            signedReq({ event_id: 'evt_5', event_type: 'payment.completed', metadata: {} }),
            res
        );
        expect(res.statusCode).toBe(401);
    });
});
