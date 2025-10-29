/**
 * Vercel Serverless Function: Stripe Webhook を処理
 * 
 * 目的: Stripe からの Webhook イベントを処理
 * エンドポイント: POST /api/stripe-webhook
 */

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { buffer } from 'micro';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Vercel の設定: body parser を無効化
export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  // POST リクエストのみ許可
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const buf = await buffer(req);
  const sig = req.headers['stripe-signature'];

  let event;

  try {
    // Webhook の署名を検証
    event = stripe.webhooks.constructEvent(
      buf,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (error) {
    console.error('Webhook signature verification failed:', error.message);
    return res.status(400).send(`Webhook Error: ${error.message}`);
  }

  // イベントタイプに応じて処理
  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutSessionCompleted(event.data.object);
        break;

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await handleSubscriptionUpdate(event.data.object);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object);
        break;

      case 'invoice.payment_succeeded':
        await handleInvoicePaymentSucceeded(event.data.object);
        break;

      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(event.data.object);
        break;

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Error processing webhook:', error);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
}

/**
 * Checkout セッション完了時の処理
 */
async function handleCheckoutSessionCompleted(session) {
  const userId = session.metadata.userId;
  const subscriptionId = session.subscription;

  console.log(`Checkout completed for user ${userId}, subscription ${subscriptionId}`);

  // サブスクリプション情報を取得
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);

  // Supabase に保存
  const { error } = await supabase
    .from('subscriptions')
    .upsert({
      user_id: userId,
      subscription_id: subscriptionId,
      customer_id: session.customer,
      status: subscription.status,
      current_period_start: subscription.current_period_start,
      current_period_end: subscription.current_period_end,
      cancel_at_period_end: subscription.cancel_at_period_end,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'user_id'
    });

  if (error) {
    console.error('Error saving subscription to Supabase:', error);
    throw error;
  }

  console.log(`Subscription saved to Supabase for user ${userId}`);
}

/**
 * サブスクリプション更新時の処理
 */
async function handleSubscriptionUpdate(subscription) {
  const userId = subscription.metadata.userId;

  console.log(`Subscription updated for user ${userId}: ${subscription.status}`);

  // Supabase を更新
  const { error } = await supabase
    .from('subscriptions')
    .update({
      status: subscription.status,
      current_period_start: subscription.current_period_start,
      current_period_end: subscription.current_period_end,
      cancel_at_period_end: subscription.cancel_at_period_end,
      updated_at: new Date().toISOString(),
    })
    .eq('subscription_id', subscription.id);

  if (error) {
    console.error('Error updating subscription in Supabase:', error);
    throw error;
  }

  console.log(`Subscription updated in Supabase for user ${userId}`);
}

/**
 * サブスクリプション削除時の処理
 */
async function handleSubscriptionDeleted(subscription) {
  const userId = subscription.metadata.userId;

  console.log(`Subscription deleted for user ${userId}`);

  // Supabase を更新
  const { error } = await supabase
    .from('subscriptions')
    .update({
      status: 'canceled',
      updated_at: new Date().toISOString(),
    })
    .eq('subscription_id', subscription.id);

  if (error) {
    console.error('Error updating subscription in Supabase:', error);
    throw error;
  }

  console.log(`Subscription marked as canceled in Supabase for user ${userId}`);
}

/**
 * 請求書支払い成功時の処理
 */
async function handleInvoicePaymentSucceeded(invoice) {
  const subscriptionId = invoice.subscription;

  console.log(`Invoice payment succeeded for subscription ${subscriptionId}`);

  // 必要に応じて追加処理
}

/**
 * 請求書支払い失敗時の処理
 */
async function handleInvoicePaymentFailed(invoice) {
  const subscriptionId = invoice.subscription;

  console.log(`Invoice payment failed for subscription ${subscriptionId}`);

  // 必要に応じて追加処理（例: ユーザーに通知）
}

