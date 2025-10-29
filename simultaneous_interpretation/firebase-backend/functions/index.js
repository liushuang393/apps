/**
 * VoiceTranslate Pro - Firebase Functions
 * 
 * 目的: サブスクリプション管理のバックエンド処理
 * - Stripe Checkout セッションの作成
 * - Stripe Webhook の処理
 * - サブスクリプション状態の確認
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const stripe = require('stripe')(functions.config().stripe.secret_key);

admin.initializeApp();

/**
 * Stripe Checkout セッションを作成
 * 
 * @param {Object} data - リクエストデータ（空）
 * @param {Object} context - 認証コンテキスト
 * @returns {Object} セッションID
 */
exports.createCheckoutSession = functions.https.onCall(async (data, context) => {
  // 認証チェック
  if (!context.auth) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      'ユーザーがログインしていません'
    );
  }

  const userId = context.auth.uid;
  const userEmail = context.auth.token.email;

  try {
    // Stripe Checkout セッションを作成
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      customer_email: userEmail,
      line_items: [
        {
          price: functions.config().stripe.price_id, // Stripe の Price ID
          quantity: 1,
        },
      ],
      metadata: {
        userId: userId,
      },
      subscription_data: {
        trial_period_days: 7, // 7日間無料トライアル
        metadata: {
          userId: userId,
        },
      },
      success_url: `https://${context.rawRequest.headers.origin}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `https://${context.rawRequest.headers.origin}/subscription.html`,
    });

    console.log(`Checkout session created for user ${userId}: ${session.id}`);

    return {
      sessionId: session.id,
    };
  } catch (error) {
    console.error('Error creating checkout session:', error);
    throw new functions.https.HttpsError(
      'internal',
      'Checkout セッションの作成に失敗しました: ' + error.message
    );
  }
});

/**
 * サブスクリプション状態を確認
 * 
 * @param {Object} data - リクエストデータ（空）
 * @param {Object} context - 認証コンテキスト
 * @returns {Object} サブスクリプション情報
 */
exports.checkSubscription = functions.https.onCall(async (data, context) => {
  // 認証チェック
  if (!context.auth) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      'ユーザーがログインしていません'
    );
  }

  const userId = context.auth.uid;

  try {
    // Firestore からサブスクリプション情報を取得
    const subscriptionDoc = await admin
      .firestore()
      .collection('subscriptions')
      .doc(userId)
      .get();

    if (!subscriptionDoc.exists) {
      return {
        isActive: false,
        status: 'none',
        message: 'サブスクリプションが見つかりません',
      };
    }

    const subscription = subscriptionDoc.data();

    // サブスクリプション状態を確認
    const isActive = subscription.status === 'active' || subscription.status === 'trialing';

    return {
      isActive: isActive,
      status: subscription.status,
      currentPeriodEnd: subscription.current_period_end,
      cancelAtPeriodEnd: subscription.cancel_at_period_end || false,
    };
  } catch (error) {
    console.error('Error checking subscription:', error);
    throw new functions.https.HttpsError(
      'internal',
      'サブスクリプションの確認に失敗しました: ' + error.message
    );
  }
});

/**
 * Stripe Webhook を処理
 * 
 * @param {Object} req - HTTPリクエスト
 * @param {Object} res - HTTPレスポンス
 */
exports.stripeWebhook = functions.https.onRequest(async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = functions.config().stripe.webhook_secret;

  let event;

  try {
    // Webhook の署名を検証
    event = stripe.webhooks.constructEvent(req.rawBody, sig, webhookSecret);
  } catch (error) {
    console.error('Webhook signature verification failed:', error.message);
    return res.status(400).send(`Webhook Error: ${error.message}`);
  }

  // イベントタイプに応じて処理
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
});

/**
 * Checkout セッション完了時の処理
 * 
 * @param {Object} session - Checkout セッション
 */
async function handleCheckoutSessionCompleted(session) {
  const userId = session.metadata.userId;
  const subscriptionId = session.subscription;

  console.log(`Checkout completed for user ${userId}, subscription ${subscriptionId}`);

  // サブスクリプション情報を取得
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);

  // Firestore に保存
  await admin
    .firestore()
    .collection('subscriptions')
    .doc(userId)
    .set({
      subscription_id: subscriptionId,
      customer_id: session.customer,
      status: subscription.status,
      current_period_start: subscription.current_period_start,
      current_period_end: subscription.current_period_end,
      cancel_at_period_end: subscription.cancel_at_period_end,
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    });

  console.log(`Subscription saved to Firestore for user ${userId}`);
}

/**
 * サブスクリプション更新時の処理
 * 
 * @param {Object} subscription - サブスクリプション
 */
async function handleSubscriptionUpdate(subscription) {
  const userId = subscription.metadata.userId;

  console.log(`Subscription updated for user ${userId}: ${subscription.status}`);

  // Firestore を更新
  await admin
    .firestore()
    .collection('subscriptions')
    .doc(userId)
    .update({
      status: subscription.status,
      current_period_start: subscription.current_period_start,
      current_period_end: subscription.current_period_end,
      cancel_at_period_end: subscription.cancel_at_period_end,
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    });

  console.log(`Subscription updated in Firestore for user ${userId}`);
}

/**
 * サブスクリプション削除時の処理
 * 
 * @param {Object} subscription - サブスクリプション
 */
async function handleSubscriptionDeleted(subscription) {
  const userId = subscription.metadata.userId;

  console.log(`Subscription deleted for user ${userId}`);

  // Firestore を更新
  await admin
    .firestore()
    .collection('subscriptions')
    .doc(userId)
    .update({
      status: 'canceled',
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    });

  console.log(`Subscription marked as canceled in Firestore for user ${userId}`);
}

/**
 * 請求書支払い成功時の処理
 * 
 * @param {Object} invoice - 請求書
 */
async function handleInvoicePaymentSucceeded(invoice) {
  const subscriptionId = invoice.subscription;

  console.log(`Invoice payment succeeded for subscription ${subscriptionId}`);

  // 必要に応じて追加処理
}

/**
 * 請求書支払い失敗時の処理
 * 
 * @param {Object} invoice - 請求書
 */
async function handleInvoicePaymentFailed(invoice) {
  const subscriptionId = invoice.subscription;

  console.log(`Invoice payment failed for subscription ${subscriptionId}`);

  // 必要に応じて追加処理（例: ユーザーに通知）
}

