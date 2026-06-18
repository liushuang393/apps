/**
 * VoiceTranslate Pro - 設定ファイル
 *
 * 目的: すべての設定を一箇所に集中管理
 * - Supabase設定
 * - Stripe設定
 * - Vercel API設定
 * - アプリケーション設定
 *
 * 注意: Service Worker（background.js）とHTML pagesの両方で使用可能
 */

const CONFIG = {
    // Supabase 設定
    supabase: {
        url: 'https://axtpvqdzagnnuacgkchr.supabase.co',
        anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF4dHB2cWR6YWdubnVhY2drY2hyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE3MDMwNDYsImV4cCI6MjA3NzI3OTA0Nn0.D-G0WLBvGJVYn6EU2SUvHMlyFdE9mw-pjjhTwUUmeuY'
    },

    // Stripe 設定
    stripe: {
        // Publishable Key（テストモード）
        publishableKey:
            'pk_test_51S9jDCD2OGoEQuqPIhYLWObKPb3JlRMCFCJ31LPLuPicfLc1ZPxUSxSJxT5Yccie3ypY5odld4deFlqu6ZupJlQg00WWzlUtCo',

        // Price ID
        priceId: 'price_1SNVvsD2OGoEQuqPEgPmOBmi'
    },

    // Vercel API エンドポイント
    api: {
        baseUrl: 'https://apps-five-woad.vercel.app',
        endpoints: {
            createCheckoutSession: '/api/create-checkout-session',
            checkSubscription: '/api/check-subscription',
            stripeWebhook: '/api/stripe-webhook'
        }
    },

    // アプリケーション設定
    app: {
        // サブスクリプション料金
        subscription: {
            price: '550円/月',
            priceUSD: '$3/月',
            trialDays: 7
        },

        // OpenAI API 料金（参考情報）
        openai: {
            inputCost: '0.06ドル/分',
            outputCost: '0.24ドル/分',
            estimatedCost: '0.50-1.00ドル/時間'
        }
    }
};

/**
 * グローバルに公開
 *
 * globalThis は Service Worker・ブラウザ・Node のいずれの環境でも同一の
 * グローバルオブジェクトを指すため、これ1つで全環境に対応できる。
 */
if (typeof globalThis !== 'undefined') {
    globalThis.CONFIG = CONFIG;
}
