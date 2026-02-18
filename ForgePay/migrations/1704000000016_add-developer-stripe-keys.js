/**
 * マイグレーション: 開発者ごとの Stripe キーを追加（マルチテナント対応）
 * 
 * 各開発者が自分の Stripe アカウントを使用できるようにする。
 * ForgePay のグローバル Stripe キーは開発者がキーを設定していない場合のフォールバックとして使用。
 */

exports.up = (pgm) => {
  pgm.addColumn('developers', {
    stripe_secret_key_enc: {
      type: 'text',
      comment: '開発者の Stripe Secret Key（暗号化済み）',
    },
    stripe_publishable_key: {
      type: 'varchar(255)',
      comment: '開発者の Stripe Publishable Key',
    },
    stripe_webhook_endpoint_secret: {
      type: 'varchar(255)',
      comment: '開発者のStripe Webhook Endpoint Secret',
    },
    stripe_configured: {
      type: 'boolean',
      default: false,
      notNull: true,
      comment: '開発者が自前の Stripe キーを設定済みかどうか',
    },
  });

  pgm.sql(`
    COMMENT ON COLUMN developers.stripe_secret_key_enc IS '開発者の Stripe Secret Key（AES-256暗号化）';
    COMMENT ON COLUMN developers.stripe_publishable_key IS '開発者の Stripe Publishable Key（公開キー）';
    COMMENT ON COLUMN developers.stripe_webhook_endpoint_secret IS '開発者のStripe Webhook Endpoint Secret';
    COMMENT ON COLUMN developers.stripe_configured IS 'Stripe 設定が完了しているかどうか';
  `);
};

exports.down = (pgm) => {
  pgm.dropColumn('developers', [
    'stripe_secret_key_enc',
    'stripe_publishable_key',
    'stripe_webhook_endpoint_secret',
    'stripe_configured',
  ]);
};
