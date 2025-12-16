/**
 * Stripe Client Wrapper for Chrome Extension
 * 
 * 目的:
 *   Chrome Extension環境でStripeを使用可能にする
 * 
 * 注意:
 *   - Manifest V3では外部CDNスクリプトの読み込みが禁止されている
 *   - Stripeは公式にCDN経由での読み込みを推奨しているため、
 *     このラッパーはStripe Checkoutへのリダイレクトのみを処理する
 */

(function(global) {
    'use strict';
    
    /**
     * Stripe Checkout用のシンプルなラッパー
     * 
     * @param {string} publishableKey - Stripe公開可能キー
     * @returns {Object} Stripeクライアントインスタンス
     */
    function Stripe(publishableKey) {
        return {
            /**
             * Checkoutセッションにリダイレクト
             * 
             * @param {Object} options - リダイレクトオプション
             * @param {string} options.sessionId - Stripe CheckoutセッションID
             * @returns {Promise<Object>} リダイレクト結果
             */
            redirectToCheckout: async function(options) {
                if (!options || !options.sessionId) {
                    return {
                        error: {
                            message: 'Session ID is required'
                        }
                    };
                }
                
                try {
                    // Stripe Checkoutページにリダイレクト
                    const checkoutUrl = `https://checkout.stripe.com/c/pay/${options.sessionId}`;
                    
                    // Chrome Extension環境では chrome.tabs.create を使用
                    if (typeof chrome !== 'undefined' && chrome.tabs) {
                        chrome.tabs.create({ url: checkoutUrl });
                    } else {
                        // 通常のブラウザ環境
                        window.location.href = checkoutUrl;
                    }
                    
                    return { error: null };
                } catch (error) {
                    return {
                        error: {
                            message: error.message || 'Failed to redirect to checkout'
                        }
                    };
                }
            },
            
            /**
             * Payment Elementを作成（簡易版）
             * 
             * 注意: 完全な実装にはStripe.js本体が必要
             * この実装はCheckoutフローのみをサポート
             */
            elements: function() {
                console.warn('Stripe Elements is not fully supported in this wrapper. Use Checkout instead.');
                return {
                    create: function() {
                        return {
                            mount: function() {
                                console.warn('Stripe Elements mount is not supported. Use redirectToCheckout instead.');
                            }
                        };
                    }
                };
            }
        };
    }
    
    /**
     * Stripe Checkoutセッションを作成
     * 
     * @param {string} apiEndpoint - Vercel APIエンドポイント
     * @param {Object} params - セッションパラメータ
     * @returns {Promise<string>} セッションID
     */
    async function createCheckoutSession(apiEndpoint, params) {
        try {
            const response = await fetch(apiEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(params)
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || 'Failed to create checkout session');
            }
            
            const data = await response.json();
            return data.sessionId;
        } catch (error) {
            console.error('Failed to create checkout session:', error);
            throw error;
        }
    }
    
    // グローバルに公開
    if (typeof window !== 'undefined') {
        window.Stripe = Stripe;
        window.createCheckoutSession = createCheckoutSession;
    }
    if (typeof self !== 'undefined') {
        self.Stripe = Stripe;
        self.createCheckoutSession = createCheckoutSession;
    }
    if (typeof globalThis !== 'undefined') {
        globalThis.Stripe = Stripe;
        globalThis.createCheckoutSession = createCheckoutSession;
    }
    
})(typeof self !== 'undefined' ? self : this);

