/**
 * Vercel Serverless Function: サブスクリプション状態を確認
 * 
 * 目的: ユーザーのサブスクリプション状態を確認
 * エンドポイント: POST /api/check-subscription
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
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

    // Supabase からサブスクリプション情報を取得
    const { data: subscription, error: dbError } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', user.id)
      .single();

    if (dbError && dbError.code !== 'PGRST116') {
      // PGRST116 = No rows found (サブスクリプションが見つからない)
      console.error('Database error:', dbError);
      return res.status(500).json({ error: 'Database error' });
    }

    if (!subscription) {
      return res.status(200).json({
        isActive: false,
        status: 'none',
        message: 'サブスクリプションが見つかりません',
      });
    }

    // サブスクリプション状態を確認
    const isActive = subscription.status === 'active' || subscription.status === 'trialing';

    return res.status(200).json({
      isActive: isActive,
      status: subscription.status,
      currentPeriodEnd: subscription.current_period_end,
      cancelAtPeriodEnd: subscription.cancel_at_period_end || false,
    });
  } catch (error) {
    console.error('Error checking subscription:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message,
    });
  }
}

