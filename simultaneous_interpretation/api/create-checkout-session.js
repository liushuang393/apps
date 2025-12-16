/**
 * Vercel Serverless Function: Stripe Checkout セッションを作成
 *
 * 目的: サブスクリプション登録のための Stripe Checkout セッションを作成
 * エンドポイント: POST /api/create-checkout-session
 */

const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async function handler(req, res) {
  // CORS ヘッダーを設定
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  // OPTIONS リクエストの処理
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // POST リクエストのみ許可
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // リクエストボディからパラメータを取得
    const { token, userId, successUrl, cancelUrl } = req.body;

    let userEmail = null;
    let userIdToUse = null;

    // モード1: Supabase認証（トークンあり）
    if (token) {
      console.log('[Auth] Supabase認証モード');

      // Supabase でトークンを検証
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);

      if (authError || !user) {
        return res.status(401).json({ error: 'Unauthorized: Invalid token' });
      }

      userEmail = user.email;
      userIdToUse = user.id;
      console.log(`[Auth] Supabase user authenticated: ${user.id}`);
    }
    // モード2: Chrome拡張機能モード（トークンなし）
    else if (userId) {
      console.log('[Auth] Chrome拡張機能モード（認証なし）');
      userIdToUse = userId;
      // Chrome拡張機能の場合、メールアドレスは不要（後で入力可能）
      console.log(`[Auth] Extension user ID: ${userId}`);
    }
    // どちらのパラメータもない場合はエラー
    else {
      return res.status(400).json({
        error: 'Bad Request: Either token or userId must be provided'
      });
    }

    // Stripe Checkout セッションを作成
    const sessionConfig = {
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [
        {
          price: process.env.STRIPE_PRICE_ID,
          quantity: 1,
        },
      ],
      metadata: {
        userId: userIdToUse,
      },
      subscription_data: {
        trial_period_days: 7, // 7日間無料トライアル
        metadata: {
          userId: userIdToUse,
        },
      },
      success_url: successUrl || `${req.headers.origin || 'chrome-extension://YOUR_EXTENSION_ID'}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl || `${req.headers.origin || 'chrome-extension://YOUR_EXTENSION_ID'}/subscription.html`,
    };

    // メールアドレスがある場合のみ設定
    if (userEmail) {
      sessionConfig.customer_email = userEmail;
    }

    const session = await stripe.checkout.sessions.create(sessionConfig);

    console.log(`[Stripe] Checkout session created for user ${userIdToUse}: ${session.id}`);

    return res.status(200).json({
      sessionId: session.id,
    });
  } catch (error) {
    console.error('[Error] Failed to create checkout session:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message,
    });
  }
}

