/**
 * Vercel Serverless Function: 決済セッションを作成（ForgePay QuickPay 経由）
 *
 * 公式手順書 `docs/ForgePay決済システムの他システム実装指南.md` に準拠。
 *   - 認証は ForgePay の X-API-Key（サーバ環境変数）のみ。
 *   - purchase_intent_id はアプリ側で発行する一意 ID（クライアントが生成・保持する UUID）。
 *     ※ ForgePay は Supabase トークンを読まない。アプリ独自の身分認証は不要。
 *   - 重複課金防止: 既に有効な権限があれば新規セッションを作らず 409。
 *
 * エンドポイント: POST /api/create-checkout-session
 * リクエスト: { purchase_intent_id: string, plan?: "subscription"|"onetime",
 *               productId?, priceId?, customerEmail?, successUrl?, cancelUrl? }
 * レスポンス（201）: { checkout_url, session_id, expires_at, sessionId }
 *
 * 環境変数: FORGEPAY_API_URL, FORGEPAY_API_KEY,
 *   FORGEPAY_SUBSCRIPTION_PRODUCT_ID, FORGEPAY_ONETIME_PRODUCT_ID,
 *   FORGEPAY_ONETIME_AMOUNT, FORGEPAY_CURRENCY, APP_PUBLIC_URL
 */

'use strict';

const { createPayment, verifyEntitlement, ForgePayError } = require('./_forgepay');

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
 * プランとリクエストから ForgePay createPayment 用パラメータを組み立てる。
 *
 * @param {{purchaseIntentId:string, plan:string, productId?:string, priceId?:string, customerEmail?:string, successUrl?:string, cancelUrl?:string}} input
 * @returns {object} createPayment 引数
 * @throws {ForgePayError} 商品/価格の解決ができない場合（設定不足）
 */
function buildPaymentParams(input) {
    const params = {
        purchaseIntentId: input.purchaseIntentId,
        metadata: { plan: input.plan, source: 'voicetranslate' }
    };

    if (input.customerEmail != null) {
        params.customerEmail = input.customerEmail;
    }

    // success/cancel: リクエスト > 環境変数 > ForgePay ダッシュボード既定（未指定）
    const appUrl = process.env.APP_PUBLIC_URL;
    const successUrl =
        input.successUrl || (appUrl ? `${appUrl.replace(/\/+$/, '')}/success.html` : undefined);
    const cancelUrl =
        input.cancelUrl || (appUrl ? `${appUrl.replace(/\/+$/, '')}/subscription.html` : undefined);
    if (successUrl != null) {
        params.successUrl = successUrl;
    }
    if (cancelUrl != null) {
        params.cancelUrl = cancelUrl;
    }

    // 商品の解決優先順位: productId > priceId > プラン別の環境変数 > アドホック
    if (input.productId != null) {
        params.productId = input.productId;
        return params;
    }
    if (input.priceId != null) {
        params.priceId = input.priceId;
        return params;
    }

    if (input.plan === 'subscription') {
        const productId = process.env.FORGEPAY_SUBSCRIPTION_PRODUCT_ID;
        if (productId == null || productId === '') {
            throw new ForgePayError(
                'サブスクリプション商品が未設定です（FORGEPAY_SUBSCRIPTION_PRODUCT_ID）',
                500,
                'product_not_configured'
            );
        }
        params.productId = productId;
        return params;
    }

    // plan === 'onetime'
    const onetimeProductId = process.env.FORGEPAY_ONETIME_PRODUCT_ID;
    if (onetimeProductId != null && onetimeProductId !== '') {
        params.productId = onetimeProductId;
        return params;
    }

    // 商品未設定ならアドホック（金額直接指定）にフォールバック
    const amount = Number(process.env.FORGEPAY_ONETIME_AMOUNT);
    if (!Number.isFinite(amount) || amount <= 0) {
        throw new ForgePayError(
            '一回払いの商品/金額が未設定です（FORGEPAY_ONETIME_PRODUCT_ID か FORGEPAY_ONETIME_AMOUNT）',
            500,
            'product_not_configured'
        );
    }
    params.name = 'VoiceTranslate Pro（買い切り）';
    params.amount = amount;
    params.currency = (process.env.FORGEPAY_CURRENCY || 'jpy').toLowerCase();
    return params;
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
        const body = req.body || {};
        const plan = body.plan === 'onetime' ? 'onetime' : 'subscription';
        // purchase_intent_id はアプリ側で発行した一意 ID（クライアント生成・保持の UUID）
        const purchaseIntentId = body.purchase_intent_id || body.userId;

        if (typeof purchaseIntentId !== 'string' || purchaseIntentId === '') {
            json(400, {
                error: 'invalid_request',
                message: 'purchase_intent_id は必須です'
            });
            return;
        }

        // ── 重複課金防止 ─────────────────────────────────────────
        const current = await verifyEntitlement(purchaseIntentId);
        if (current.active) {
            json(409, {
                error: 'already_active',
                message: '既に有効なサブスクリプション/購入があります',
                isActive: true,
                status: current.status,
                expiresAt: current.expiresAt
            });
            return;
        }

        const params = buildPaymentParams({
            purchaseIntentId,
            plan,
            productId: body.productId,
            priceId: body.priceId,
            customerEmail: body.customerEmail,
            successUrl: body.successUrl,
            cancelUrl: body.cancelUrl
        });

        const result = await createPayment(params);

        json(201, {
            checkout_url: result.checkoutUrl,
            session_id: result.sessionId,
            sessionId: result.sessionId, // 後方互換
            expires_at: result.expiresAt
        });
    } catch (error) {
        if (error instanceof ForgePayError) {
            // 設定不足（こちら側の問題）は 500。上流の 4xx はそのまま。それ以外は 502。
            let status;
            if (error.code === 'product_not_configured') {
                status = 500;
            } else if (error.status >= 400 && error.status < 500) {
                status = error.status;
            } else {
                status = 502;
            }
            json(status, { error: error.code || 'forgepay_error', message: error.message });
            return;
        }
        json(500, {
            error: 'internal_error',
            message: error instanceof Error ? error.message : String(error)
        });
    }
};
