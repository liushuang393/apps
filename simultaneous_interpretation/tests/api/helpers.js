/**
 * tests/api 共通ヘルパー
 *
 * Vercel サーバレス関数（api/*.js）はシグネチャ (req, res) を持つ素の関数なので、
 * Express を立ち上げず、最小のモック req/res で直接呼び出してテストする。
 * ForgePay への通信は global.fetch をモックして遮断する（外部通信なし・決定論的）。
 */

'use strict';

/**
 * モックのレスポンスオブジェクトを作る。
 * @returns {{statusCode:number, headers:object, body:any, ended:boolean, setHeader:Function, end:Function, json:Function}}
 */
function createRes() {
    const res = {
        statusCode: 200,
        headers: {},
        body: undefined,
        ended: false
    };
    res.setHeader = (key, value) => {
        res.headers[String(key).toLowerCase()] = value;
    };
    res.end = (payload) => {
        res.ended = true;
        res.body = payload;
    };
    /** レスポンスボディを JSON としてパースする。 */
    res.json = () => (res.body != null && res.body !== '' ? JSON.parse(res.body) : undefined);
    return res;
}

/**
 * モックのリクエストオブジェクトを作る。
 * @param {string} method - HTTP メソッド
 * @param {object} [body] - リクエストボディ（パース済みオブジェクト）
 * @param {object} [headers] - ヘッダー（小文字キー）
 * @returns {{method:string, body:object, headers:object}}
 */
function createReq(method, body, headers) {
    return { method, body: body || {}, headers: headers || {} };
}

/**
 * fetch のレスポンス互換オブジェクトを作る（_forgepay は status と text() のみ使用）。
 * @param {number} status
 * @param {object|null} obj - JSON 本体
 * @returns {{status:number, ok:boolean, text:Function}}
 */
function fetchResponse(status, obj) {
    return {
        status,
        ok: status >= 200 && status < 300,
        text: async () => (obj == null ? '' : JSON.stringify(obj))
    };
}

/**
 * URL に応じて ForgePay のレスポンスを出し分ける fetch モックを作る。
 *
 * @param {{verify?:{status:number,body:object}, quickpay?:{status:number,body:object}}} routes
 * @returns {jest.Mock} fetch モック（呼び出し履歴は .mock.calls で参照可能）
 */
function makeForgePayFetch(routes) {
    return jest.fn(async (url) => {
        const u = String(url);
        if (u.includes('/auth/v1/user')) {
            return routes.auth
                ? fetchResponse(routes.auth.status, routes.auth.body)
                : fetchResponse(200, { id: 'auth_user_default' });
        }
        if (u.includes('/entitlements/verify') && routes.verify) {
            return fetchResponse(routes.verify.status, routes.verify.body);
        }
        if (u.includes('/quickpay') && routes.quickpay) {
            return fetchResponse(routes.quickpay.status, routes.quickpay.body);
        }
        throw new Error(`未対応のモック URL: ${u}`);
    });
}

module.exports = { createReq, createRes, fetchResponse, makeForgePayFetch };
