/**
 * Vercel Serverless Function: ForgePay コールバック受信（HMAC 署名検証）
 *
 * 公式手順書 `docs/ForgePay決済システムの他システム実装指南.md` §7 に準拠。
 * ForgePay が決済/返金イベント時に、登録した callback_url へ JSON を POST する。
 *
 * 署名検証（必須）:
 *   - ヘッダ X-ForgePay-Timestamp（ISO 8601）, X-ForgePay-Signature（`sha256=<hex>`）
 *   - 署名対象 = `${timestamp}.${rawBody}` を callback_secret で HMAC-SHA256 → hex
 *   - timingSafeEqual で比較。timestamp 鮮度（±5分）と event_id（nonce）でリプレイ防止。
 *   - 署名不一致・欠如・期限切れは fail-closed で 401。
 *
 * エンドポイント: POST /api/forgepay-callback
 * 環境変数: FORGEPAY_CALLBACK_SECRET（必須。ForgePay 側の callback_secret と一致させる）
 */

'use strict';

const crypto = require('crypto');

const MAX_SKEW_MS = 5 * 60 * 1000;

/** 処理済み event_id（プロセス内・冪等化用）。 @type {Set<string>} */
const processedEventIds = new Set();
const MAX_TRACKED_EVENTS = 1000;

/**
 * 生のリクエストボディを取得する。
 * @param {any} req
 * @returns {Promise<string>}
 */
async function readRawBody(req) {
    if (typeof req.rawBody === 'string') {
        return req.rawBody;
    }
    if (Buffer.isBuffer(req.rawBody)) {
        return req.rawBody.toString('utf8');
    }
    return await new Promise((resolve, reject) => {
        let data = '';
        req.on('data', (chunk) => {
            data += chunk;
        });
        req.on('end', () => resolve(data));
        req.on('error', reject);
    });
}

/**
 * タイミング安全な文字列比較。
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function timingSafeEqualStr(a, b) {
    const ba = Buffer.from(String(a));
    const bb = Buffer.from(String(b));
    if (ba.length !== bb.length) {
        return false;
    }
    return crypto.timingSafeEqual(ba, bb);
}

/**
 * event_id を処理済みとして記録（FIFO で上限管理）。
 * @param {string} eventId
 */
function markProcessed(eventId) {
    if (processedEventIds.size >= MAX_TRACKED_EVENTS) {
        const oldest = processedEventIds.values().next().value;
        if (oldest !== undefined) {
            processedEventIds.delete(oldest);
        }
    }
    processedEventIds.add(eventId);
}

/**
 * @param {any} req
 * @param {import('http').ServerResponse} res
 */
async function handler(req, res) {
    /** @type {(status:number, payload:object)=>void} */
    const json = (status, payload) => {
        res.statusCode = status;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(payload));
    };

    if (req.method !== 'POST') {
        json(405, { error: 'Method not allowed' });
        return;
    }

    // 署名検証用シークレット（未設定なら fail-closed）
    const secret = process.env.FORGEPAY_CALLBACK_SECRET;
    if (secret == null || secret === '') {
        json(401, { error: 'unauthorized', message: 'callback secret 未設定' });
        return;
    }

    const rawBody = await readRawBody(req);
    const timestamp = req.headers['x-forgepay-timestamp'];
    const signature = req.headers['x-forgepay-signature'];

    if (typeof timestamp !== 'string' || typeof signature !== 'string') {
        json(401, { error: 'unauthorized', message: '署名ヘッダがありません' });
        return;
    }

    // 署名検証
    const expected =
        'sha256=' +
        crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
    if (!timingSafeEqualStr(expected, signature)) {
        json(401, { error: 'unauthorized', message: '署名が一致しません' });
        return;
    }

    // タイムスタンプ鮮度（リプレイ防止）
    const tsMs = Date.parse(timestamp);
    if (Number.isNaN(tsMs) || Math.abs(Date.now() - tsMs) > MAX_SKEW_MS) {
        json(401, { error: 'unauthorized', message: 'timestamp が古すぎます' });
        return;
    }

    let payload;
    try {
        payload = rawBody ? JSON.parse(rawBody) : {};
    } catch {
        json(400, { error: 'invalid_request', message: 'JSON 解析に失敗しました' });
        return;
    }

    const eventId = payload.event_id;
    const eventType = payload.event_type;
    const purchaseIntentId =
        payload.metadata && payload.metadata.purchase_intent_id
            ? payload.metadata.purchase_intent_id
            : null;

    // 冪等性: 既処理イベントは即 200
    if (typeof eventId === 'string' && eventId !== '' && processedEventIds.has(eventId)) {
        json(200, { received: true, duplicate: true });
        return;
    }

    switch (eventType) {
        case 'payment.completed':
            console.info(`[ForgePay] payment.completed purchase_intent_id=${purchaseIntentId}`);
            break;
        case 'refund.completed':
            // ForgePay が entitlement を revoke 済み。次回 verify で失効を検知する。
            console.info(`[ForgePay] refund.completed purchase_intent_id=${purchaseIntentId}`);
            break;
        default:
            console.info(`[ForgePay] 未処理イベント: ${eventType}`);
    }

    if (typeof eventId === 'string' && eventId !== '') {
        markProcessed(eventId);
    }

    // 正常受信は常に 200（ForgePay の再送抑止）
    json(200, { received: true });
}

module.exports = handler;
// bodyParser を無効化し、署名検証のため生のボディを読む（Vercel 設定）
module.exports.config = { api: { bodyParser: false } };
// テスト用: 冪等化セットをリセット
module.exports._reset = function reset() {
    processedEventIds.clear();
};
