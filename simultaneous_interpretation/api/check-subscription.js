/**
 * Vercel Serverless Function: 購入/サブスクリプション状態を確認（ForgePay 経由）
 *
 * 公式手順書 `docs/ForgePay決済システムの他システム実装指南.md` §6 に準拠。
 * 2 通りのキーで照会できる:
 *   - unlock_token   … 決済直後に ForgePay が発行する 1 回限りの JWT（最も確実）
 *   - purchase_intent_id … アプリ側が発行した一意 ID（再訪問時の再確認用）
 *
 * エンドポイント: POST /api/check-subscription
 * リクエスト: { unlock_token?: string, purchase_intent_id?: string }
 * レスポンス: { isActive, status, expiresAt, productId }
 *
 * 環境変数: FORGEPAY_API_URL, FORGEPAY_API_KEY
 */

'use strict';

const { verifyEntitlement, verifyByUnlockToken, ForgePayError } = require('./_forgepay');

/**
 * CORS ヘッダーを設定する。
 * @param {import('http').ServerResponse} res
 */
function setCors(res) {
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With, Content-Type, Accept');
}

/**
 * @param {import('http').IncomingMessage & {method?:string, body?:any}} req
 * @param {import('http').ServerResponse} res
 */
module.exports = async function handler(req, res) {
    setCors(res);

    if (req.method === 'OPTIONS') {
        res.statusCode = 200;
        res.end();
        return;
    }

    if (req.method !== 'POST') {
        res.statusCode = 405;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
    }

    /** @type {(status:number, payload:object)=>void} */
    const json = (status, payload) => {
        res.statusCode = status;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(payload));
    };

    try {
        // 開発用バイパス（多層防御）:
        //   NODE_ENV !== 'production' かつ FORGEPAY_DEV_BYPASS_SECRET が設定済みで、
        //   リクエストヘッダ x-dev-bypass がその値と一致する場合のみ、ForgePay 照会を
        //   省略して有効扱いを返す。本番（production）では完全に無効。
        const bypassSecret = process.env.FORGEPAY_DEV_BYPASS_SECRET;
        if (
            process.env.NODE_ENV !== 'production' &&
            typeof bypassSecret === 'string' &&
            bypassSecret !== '' &&
            req.headers['x-dev-bypass'] === bypassSecret
        ) {
            json(200, { isActive: true, status: 'active', expiresAt: null, productId: null });
            return;
        }

        const body = req.body || {};
        const unlockToken = body.unlock_token;
        const purchaseIntentId = body.purchase_intent_id || body.userId;

        let entitlement;
        if (typeof unlockToken === 'string' && unlockToken !== '') {
            entitlement = await verifyByUnlockToken(unlockToken);
        } else if (typeof purchaseIntentId === 'string' && purchaseIntentId !== '') {
            entitlement = await verifyEntitlement(purchaseIntentId);
        } else {
            json(400, {
                error: 'invalid_request',
                message: 'unlock_token または purchase_intent_id が必要です'
            });
            return;
        }

        json(200, {
            isActive: entitlement.active,
            status: entitlement.status || 'none',
            expiresAt: entitlement.expiresAt,
            productId: entitlement.productId
        });
    } catch (error) {
        if (error instanceof ForgePayError) {
            const status = error.status >= 400 && error.status < 500 ? error.status : 502;
            json(status, { error: error.code || 'forgepay_error', message: error.message });
            return;
        }
        json(500, {
            error: 'internal_error',
            message: error instanceof Error ? error.message : String(error)
        });
    }
};
