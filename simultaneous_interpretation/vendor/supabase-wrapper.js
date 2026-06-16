/**
 * Supabase Client Wrapper for Chrome Extension
 *
 * 目的:
 *   Chrome Extension環境でSupabaseクライアントを使用可能にする
 *
 * 注意:
 *   - Manifest V3では外部CDNスクリプトの読み込みが禁止されている
 *   - このファイルはローカルにバンドルされたSupabaseクライアントのラッパー
 */

(function (global) {
    'use strict';

    /**
     * Supabaseクライアントを作成
     *
     * @param {string} supabaseUrl - Supabase プロジェクトURL
     * @param {string} supabaseKey - Supabase 匿名キー
     * @param {Object} options - オプション設定
     * @returns {Object} Supabaseクライアントインスタンス
     */
    function createClient(supabaseUrl, supabaseKey, options = {}) {
        // 基本的なHTTPクライアント実装
        const client = {
            auth: {
                /**
                 * Googleでサインイン
                 */
                signInWithOAuth: async function (provider) {
                    // ✅ Supabase OAuth 正しいフロー
                    // Chrome拡張機能では、OAuth リダイレクトを直接開く
                    const redirectTo =
                        provider.options?.redirectTo ||
                        (typeof chrome !== 'undefined' && chrome.runtime
                            ? chrome.runtime.getURL('subscription.html')
                            : window.location.origin + '/subscription.html');

                    // OAuth URL を構築（Supabase の正しい形式）
                    const params = new URLSearchParams();
                    params.append('provider', provider.provider);
                    params.append('redirect_to', redirectTo);

                    // 追加のクエリパラメータ
                    if (provider.options?.queryParams) {
                        Object.entries(provider.options.queryParams).forEach(([key, value]) => {
                            params.append(key, value);
                        });
                    }

                    const authUrl = `${supabaseUrl}/auth/v1/authorize?${params.toString()}`;

                    console.info('[Supabase] ========== OAuth 開始 ==========');
                    console.info('[Supabase] Provider:', provider.provider);
                    console.info('[Supabase] Redirect To:', redirectTo);
                    console.info('[Supabase] Auth URL:', authUrl);
                    console.info(
                        '[Supabase] Chrome環境:',
                        typeof chrome !== 'undefined' && chrome.tabs ? 'YES' : 'NO'
                    );
                    console.info('[Supabase] =====================================');

                    // Chrome拡張機能では新しいタブでOAuthを開く
                    if (typeof chrome !== 'undefined' && chrome.tabs) {
                        chrome.tabs.create({ url: authUrl });
                        return { data: { url: authUrl }, error: null };
                    } else {
                        // 通常のブラウザでは直接リダイレクト
                        window.location.href = authUrl;
                        return { data: { url: authUrl }, error: null };
                    }
                },

                /**
                 * 現在のセッションを取得
                 *
                 * Chrome拡張機能では、chrome.storage からセッション情報を取得
                 */
                getSession: async function () {
                    try {
                        // ✅ Chrome拡張機能: ローカルストレージからセッションを取得
                        if (typeof chrome !== 'undefined' && chrome.storage) {
                            return new Promise((resolve) => {
                                chrome.storage.local.get(['supabase_session'], (result) => {
                                    if (result.supabase_session) {
                                        resolve({
                                            data: { session: result.supabase_session },
                                            error: null
                                        });
                                    } else {
                                        resolve({ data: { session: null }, error: null });
                                    }
                                });
                            });
                        }

                        // ✅ 通常のブラウザ: localStorageから取得
                        const sessionStr = localStorage.getItem('supabase_session');
                        if (sessionStr) {
                            const session = JSON.parse(sessionStr);
                            return { data: { session }, error: null };
                        }

                        return { data: { session: null }, error: null };
                    } catch (error) {
                        console.error('[Supabase] getSession エラー:', error);
                        return { data: { session: null }, error };
                    }
                },

                /**
                 * セッションを設定
                 *
                 * OAuth リダイレクト後に呼び出される
                 */
                setSession: async function (tokens) {
                    try {
                        const session = {
                            access_token: tokens.access_token,
                            refresh_token: tokens.refresh_token,
                            expires_at: Date.now() + 3600 * 1000, // 1時間後
                            user: null // ユーザー情報は後で取得
                        };

                        // ✅ Chrome拡張機能: chrome.storage に保存
                        if (typeof chrome !== 'undefined' && chrome.storage) {
                            await new Promise((resolve) => {
                                chrome.storage.local.set({ supabase_session: session }, resolve);
                            });
                        } else {
                            // ✅ 通常のブラウザ: localStorage に保存
                            localStorage.setItem('supabase_session', JSON.stringify(session));
                        }

                        console.info('[Supabase] セッション保存完了');
                        return { data: { session }, error: null };
                    } catch (error) {
                        console.error('[Supabase] setSession エラー:', error);
                        return { data: { session: null }, error };
                    }
                },

                /**
                 * サインアウト
                 */
                signOut: async function () {
                    try {
                        // ✅ Chrome拡張機能: chrome.storage から削除
                        if (typeof chrome !== 'undefined' && chrome.storage) {
                            await new Promise((resolve) => {
                                chrome.storage.local.remove(['supabase_session'], resolve);
                            });
                        } else {
                            // ✅ 通常のブラウザ: localStorage から削除
                            localStorage.removeItem('supabase_session');
                        }

                        console.info('[Supabase] サインアウト完了');
                        return { error: null };
                    } catch (error) {
                        console.error('[Supabase] signOut エラー:', error);
                        return { error };
                    }
                },

                /**
                 * 匿名サインイン（ログイン画面なし）
                 *
                 * Supabase が署名付き JWT を発行する。サーバ側はこの JWT を検証して
                 * user.id を信頼できる purchase_intent_id として使う（なりすまし不可）。
                 * ※ Supabase プロジェクトで Anonymous Sign-ins を有効化しておくこと。
                 */
                signInAnonymously: async function () {
                    try {
                        const response = await fetch(`${supabaseUrl}/auth/v1/signup`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', apikey: supabaseKey },
                            body: JSON.stringify({ data: {} })
                        });
                        const data = await response.json();
                        if (!response.ok || !data.access_token) {
                            return { data: { session: null }, error: data };
                        }
                        await client.auth.setSession(data);
                        return { data: { session: data }, error: null };
                    } catch (error) {
                        console.error('[Supabase] signInAnonymously エラー:', error);
                        return { data: { session: null }, error };
                    }
                },

                /**
                 * リフレッシュトークンでアクセストークンを更新（user.id は不変）
                 */
                refreshSession: async function (refreshToken) {
                    try {
                        const response = await fetch(
                            `${supabaseUrl}/auth/v1/token?grant_type=refresh_token`,
                            {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    apikey: supabaseKey
                                },
                                body: JSON.stringify({ refresh_token: refreshToken })
                            }
                        );
                        const data = await response.json();
                        if (!response.ok || !data.access_token) {
                            return { data: { session: null }, error: data };
                        }
                        await client.auth.setSession(data);
                        return { data: { session: data }, error: null };
                    } catch (error) {
                        console.error('[Supabase] refreshSession エラー:', error);
                        return { data: { session: null }, error };
                    }
                },

                /**
                 * 有効なアクセストークンを返す。
                 * 1) 既存セッションが有効ならそれ
                 * 2) 期限切れだが refresh_token があれば更新
                 * 3) セッションが無ければ匿名サインイン
                 * いずれも取得できなければ null。
                 *
                 * @returns {Promise<string|null>}
                 */
                getValidAccessToken: async function () {
                    const { data } = await client.auth.getSession();
                    const session = data.session;
                    const now = Date.now();

                    if (
                        session &&
                        session.access_token &&
                        session.expires_at &&
                        session.expires_at - now > 60 * 1000
                    ) {
                        return session.access_token;
                    }

                    if (session && session.refresh_token) {
                        const r = await client.auth.refreshSession(session.refresh_token);
                        if (r.data.session && r.data.session.access_token) {
                            return r.data.session.access_token;
                        }
                    }

                    const a = await client.auth.signInAnonymously();
                    return a.data.session ? a.data.session.access_token : null;
                }
            },

            /**
             * テーブルからデータを取得
             */
            from: function (table) {
                return {
                    select: function (columns = '*') {
                        return {
                            eq: async function (column, value) {
                                const response = await fetch(
                                    `${supabaseUrl}/rest/v1/${table}?${column}=eq.${value}&select=${columns}`,
                                    {
                                        headers: {
                                            apikey: supabaseKey,
                                            Authorization: `Bearer ${supabaseKey}`
                                        }
                                    }
                                );

                                const data = await response.json();
                                return { data, error: null };
                            },

                            single: async function () {
                                const response = await fetch(
                                    `${supabaseUrl}/rest/v1/${table}?select=${columns}&limit=1`,
                                    {
                                        headers: {
                                            apikey: supabaseKey,
                                            Authorization: `Bearer ${supabaseKey}`
                                        }
                                    }
                                );

                                const data = await response.json();
                                return { data: data[0] || null, error: null };
                            }
                        };
                    },

                    insert: async function (values) {
                        const response = await fetch(`${supabaseUrl}/rest/v1/${table}`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                apikey: supabaseKey,
                                Authorization: `Bearer ${supabaseKey}`,
                                Prefer: 'return=representation'
                            },
                            body: JSON.stringify(values)
                        });

                        const data = await response.json();
                        return { data, error: null };
                    },

                    update: async function (values) {
                        return {
                            eq: async function (column, value) {
                                const response = await fetch(
                                    `${supabaseUrl}/rest/v1/${table}?${column}=eq.${value}`,
                                    {
                                        method: 'PATCH',
                                        headers: {
                                            'Content-Type': 'application/json',
                                            apikey: supabaseKey,
                                            Authorization: `Bearer ${supabaseKey}`,
                                            Prefer: 'return=representation'
                                        },
                                        body: JSON.stringify(values)
                                    }
                                );

                                const data = await response.json();
                                return { data, error: null };
                            }
                        };
                    }
                };
            }
        };

        return client;
    }

    // グローバルに公開
    const supabase = { createClient };

    if (typeof window !== 'undefined') {
        window.supabase = supabase;
    }
    if (typeof self !== 'undefined') {
        self.supabase = supabase;
    }
    if (typeof globalThis !== 'undefined') {
        globalThis.supabase = supabase;
    }
})(typeof self !== 'undefined' ? self : this);
