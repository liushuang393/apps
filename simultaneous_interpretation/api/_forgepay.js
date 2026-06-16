/**
 * ForgePay REST API クライアント（サーバ側専用）
 *
 * 目的:
 *   決済処理を自前で実装せず、共通決済サービス ForgePay 経由で行う。
 *   Stripe Secret Key / Webhook Secret / Price ID はアプリ側に一切持たない
 *   （全て ForgePay が管理）。
 *
 * セキュリティ:
 *   ForgePay の API キー（fpb_test_ / fpb_live_）は **サーバ環境変数のみ** で保持する。
 *   ブラウザ拡張・Electron レンダラなどクライアントには絶対に渡さない。
 *   よってこのモジュールは Vercel サーバレス関数（api/*.js）からのみ呼ばれる。
 *
 * 環境変数:
 *   - FORGEPAY_API_URL: ForgePay のベース URL（例: http://localhost:3000、本番は https://...）
 *   - FORGEPAY_API_KEY: ForgePay 開発者 API キー（fpb_test_... / fpb_live_...）
 *
 * 参照: ForgePay INTEGRATION_GUIDE.md / OpenAPI (http://localhost:3000/docs/)
 */

'use strict';

/**
 * ForgePay 由来のエラー。HTTP ステータスと ForgePay のエラーコードを保持する。
 */
class ForgePayError extends Error {
    /**
     * @param {string} message - エラーメッセージ
     * @param {number} status - 上流（ForgePay）の HTTP ステータス
     * @param {string|null} code - ForgePay のエラーコード（例: product_not_found）
     */
    constructor(message, status, code) {
        super(message);
        this.name = 'ForgePayError';
        this.status = status;
        this.code = code != null ? code : null;
    }
}

/**
 * ForgePay のベース URL を取得する。
 * @returns {string} 末尾スラッシュを除いたベース URL
 */
function getBaseUrl() {
    const url = process.env.FORGEPAY_API_URL || 'http://localhost:3000';
    return url.replace(/\/+$/, '');
}

/**
 * ForgePay API キーを取得する。未設定なら例外。
 * @returns {string} API キー
 * @throws {Error} FORGEPAY_API_KEY 未設定時
 */
function getApiKey() {
    const key = process.env.FORGEPAY_API_KEY;
    if (key == null || key === '') {
        throw new Error(
            'FORGEPAY_API_KEY が設定されていません（サーバ環境変数で設定してください）'
        );
    }
    return key;
}

/**
 * ForgePay へ JSON リクエストを送る内部ヘルパー。
 *
 * @param {string} method - HTTP メソッド
 * @param {string} path - /api/v1 配下のパス（先頭スラッシュ込み）
 * @param {object|null} body - リクエストボディ（GET 時は null）
 * @returns {Promise<{status:number, data:any}>} ステータスとパース済みボディ
 * @throws {ForgePayError} ネットワーク不通時
 */
async function request(method, path, body) {
    const url = `${getBaseUrl()}/api/v1${path}`;
    const headers = { 'X-API-Key': getApiKey() };
    /** @type {RequestInit} */
    const init = { method, headers };
    if (body != null) {
        headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body);
    }

    let response;
    try {
        response = await fetch(url, init);
    } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        throw new ForgePayError(
            `ForgePay へ接続できません: ${reason}`,
            502,
            'forgepay_unreachable'
        );
    }

    // ForgePay は常に JSON を返す想定だが、念のため失敗時はテキストを保持
    let data = null;
    const text = await response.text();
    if (text !== '') {
        try {
            data = JSON.parse(text);
        } catch {
            data = { raw: text };
        }
    }

    return { status: response.status, data };
}

/**
 * QuickPay で決済セッション（Stripe Checkout）を作成する。
 *
 * モード:
 *   - productId 指定 → ForgePay 商品 ID（subscription 型なら自動でサブスク、one_time 型なら一回払い）
 *   - priceId 指定   → 既存 Stripe Price ID
 *   - name+amount+currency → アドホック（商品未登録の一回払い）
 *
 * @param {object} params
 * @param {string} params.purchaseIntentId - 購入者を一意に識別する ID（=こちらのユーザー ID）
 * @param {string} [params.productId] - ForgePay 商品 ID（UUID）
 * @param {string} [params.priceId] - Stripe Price ID
 * @param {string} [params.name] - 商品名（アドホック時）
 * @param {number} [params.amount] - 金額・最小通貨単位（アドホック時）
 * @param {string} [params.currency] - 通貨コード（アドホック時、例: jpy）
 * @param {string} [params.customerEmail] - 顧客メールアドレス
 * @param {string} [params.successUrl] - 成功時遷移先（https 必須。省略時は ForgePay 設定値）
 * @param {string} [params.cancelUrl] - キャンセル時遷移先（省略時は ForgePay 設定値）
 * @param {object} [params.metadata] - 追加メタデータ
 * @returns {Promise<{sessionId:string, checkoutUrl:string, expiresAt:(string|null)}>}
 * @throws {ForgePayError} ForgePay がエラーを返した場合
 */
async function createPayment(params) {
    if (
        params == null ||
        typeof params.purchaseIntentId !== 'string' ||
        params.purchaseIntentId === ''
    ) {
        throw new ForgePayError('purchaseIntentId は必須です', 400, 'invalid_request');
    }

    /** @type {Record<string, unknown>} */
    const body = { purchase_intent_id: params.purchaseIntentId };

    if (params.productId != null) {
        body.product_id = params.productId;
    } else if (params.priceId != null) {
        body.price_id = params.priceId;
    } else if (params.name != null && params.amount != null && params.currency != null) {
        body.name = params.name;
        body.amount = params.amount;
        body.currency = params.currency;
    }

    if (params.customerEmail != null) {
        body.customer_email = params.customerEmail;
    }
    if (params.successUrl != null) {
        body.success_url = params.successUrl;
    }
    if (params.cancelUrl != null) {
        body.cancel_url = params.cancelUrl;
    }
    if (params.metadata != null) {
        body.metadata = params.metadata;
    }

    const { status, data } = await request('POST', '/quickpay', body);

    if (status !== 200 && status !== 201) {
        const err = data && data.error ? data.error : {};
        throw new ForgePayError(
            err.message || 'ForgePay quickpay に失敗しました',
            status,
            err.code || null
        );
    }

    return {
        sessionId: data.session_id,
        checkoutUrl: data.checkout_url,
        expiresAt: data.expires_at != null ? data.expires_at : null
    };
}

/**
 * purchase_intent_id（=ユーザー ID）の購入権限（entitlement）を照会する。
 * これが「このユーザーは有料か」の真実の源（source of truth）。
 *
 * @param {string} purchaseIntentId - ユーザー ID
 * @returns {Promise<{active:boolean, status:(string|null), productId:(string|null), expiresAt:(string|null), entitlementId:(string|null)}>}
 * @throws {ForgePayError} ForgePay が 404 以外のエラーを返した場合
 */
async function verifyEntitlement(purchaseIntentId) {
    if (typeof purchaseIntentId !== 'string' || purchaseIntentId === '') {
        throw new ForgePayError('purchaseIntentId は必須です', 400, 'invalid_request');
    }

    const path = `/entitlements/verify?purchase_intent_id=${encodeURIComponent(purchaseIntentId)}`;
    const { status, data } = await request('GET', path, null);

    // 権限なし（未購入）は 404。これはエラーではなく「inactive」として扱う。
    if (status === 404) {
        return {
            active: false,
            status: 'none',
            productId: null,
            expiresAt: null,
            entitlementId: null
        };
    }

    if (status !== 200) {
        const err = data && data.error ? data.error : {};
        throw new ForgePayError(
            err.message || 'ForgePay entitlement 照会に失敗しました',
            status,
            err.code || null
        );
    }

    return {
        active: data.has_access === true,
        status: data.status != null ? data.status : null,
        productId: data.product_id != null ? data.product_id : null,
        expiresAt: data.expires_at != null ? data.expires_at : null,
        entitlementId: data.entitlement_id != null ? data.entitlement_id : null
    };
}

/**
 * unlock_token（決済完了時に ForgePay が発行する 1 回限りの JWT）で権限を検証する。
 * 指南 §6 パターン A。無効/期限切れ/使用済みは 401。
 *
 * @param {string} unlockToken
 * @returns {Promise<{active:boolean, status:(string|null), productId:(string|null), expiresAt:(string|null), entitlementId:(string|null)}>}
 * @throws {ForgePayError} 401 以外のエラー時
 */
async function verifyByUnlockToken(unlockToken) {
    if (typeof unlockToken !== 'string' || unlockToken === '') {
        throw new ForgePayError('unlockToken は必須です', 400, 'invalid_request');
    }

    const path = `/entitlements/verify?unlock_token=${encodeURIComponent(unlockToken)}`;
    const { status, data } = await request('GET', path, null);

    // 無効・期限切れ・使用済みトークンは 401 → inactive 扱い
    if (status === 401) {
        return {
            active: false,
            status: 'invalid_token',
            productId: null,
            expiresAt: null,
            entitlementId: null
        };
    }

    if (status !== 200) {
        const err = data && data.error ? data.error : {};
        throw new ForgePayError(
            err.message || 'unlock_token の検証に失敗しました',
            status,
            err.code || null
        );
    }

    return {
        active: data.has_access === true,
        status: data.status != null ? data.status : null,
        productId: data.product_id != null ? data.product_id : null,
        expiresAt: data.expires_at != null ? data.expires_at : null,
        entitlementId: data.entitlement_id != null ? data.entitlement_id : null
    };
}

module.exports = {
    ForgePayError,
    createPayment,
    verifyEntitlement,
    verifyByUnlockToken,
    // テスト用に内部ヘルパーも公開
    _getBaseUrl: getBaseUrl,
    _getApiKey: getApiKey
};
