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
    // リクエストボディから認証トークンを取得
    const { token } = req.body;

    if (!token) {
      return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }

    // Supabase でトークンを検証
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }

    // Stripe Checkout セッションを作成
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      customer_email: user.email,
      line_items: [
        {
          price: process.env.STRIPE_PRICE_ID,
          quantity: 1,
        },
      ],
      metadata: {
        userId: user.id,
      },
      subscription_data: {
        trial_period_days: 7, // 7日間無料トライアル
        metadata: {
          userId: user.id,
        },
      },
      success_url: `${req.headers.origin || 'chrome-extension://YOUR_EXTENSION_ID'}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.headers.origin || 'chrome-extension://YOUR_EXTENSION_ID'}/subscription.html`,
    });

    console.log(`Checkout session created for user ${user.id}: ${session.id}`);

    return res.status(200).json({
      sessionId: session.id,
    });
  } catch (error) {
    console.error('Error creating checkout session:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message,
    });
  }
}

