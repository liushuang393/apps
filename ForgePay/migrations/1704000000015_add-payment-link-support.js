/**
 * マイグレーション: 決済リンク（Payment Link）機能のサポート追加
 * 
 * - products テーブルに slug（決済リンクURL用）と payment_methods を追加
 * - developers テーブルにデフォルト設定（success_url, cancel_url, locale, callback_url）を追加
 * - 既存商品に対して slug を自動生成
 */

exports.up = (pgm) => {
  // products テーブルに slug カラムを追加（決済リンクURL用）
  pgm.addColumn('products', {
    slug: {
      type: 'varchar(255)',
    },
    payment_methods: {
      type: 'jsonb',
      default: pgm.func("'[\"card\"]'::jsonb"),
    },
  });

  // slug にユニーク制約（developer_id + slug の組み合わせ）
  pgm.createIndex('products', ['developer_id', 'slug'], {
    unique: true,
    where: 'slug IS NOT NULL',
    name: 'idx_products_developer_slug_unique',
  });

  // developers テーブルにデフォルト設定を追加
  pgm.addColumn('developers', {
    default_success_url: {
      type: 'varchar(2048)',
    },
    default_cancel_url: {
      type: 'varchar(2048)',
    },
    default_locale: {
      type: 'varchar(10)',
      default: pgm.func("'auto'"),
    },
    default_currency: {
      type: 'varchar(10)',
      default: pgm.func("'usd'"),
    },
    default_payment_methods: {
      type: 'jsonb',
      default: pgm.func("'[\"card\"]'::jsonb"),
    },
    callback_url: {
      type: 'varchar(2048)',
    },
    callback_secret: {
      type: 'varchar(255)',
    },
    company_name: {
      type: 'varchar(255)',
    },
  });

  // コメント追加
  pgm.sql(`
    COMMENT ON COLUMN products.slug IS '決済リンクURL用のスラグ（developer_id内でユニーク）';
    COMMENT ON COLUMN products.payment_methods IS '利用可能な決済方法（card, konbini, bank_transfer 等）';
    COMMENT ON COLUMN developers.default_success_url IS '決済成功時のデフォルトリダイレクトURL';
    COMMENT ON COLUMN developers.default_cancel_url IS '決済キャンセル時のデフォルトリダイレクトURL';
    COMMENT ON COLUMN developers.default_locale IS 'Stripe Checkout のデフォルトロケール（ja, en, zh 等）';
    COMMENT ON COLUMN developers.default_currency IS 'デフォルト通貨（usd, jpy, eur 等）';
    COMMENT ON COLUMN developers.default_payment_methods IS 'デフォルトの決済方法';
    COMMENT ON COLUMN developers.callback_url IS '決済イベント通知先URL';
    COMMENT ON COLUMN developers.callback_secret IS 'コールバック署名用シークレット';
    COMMENT ON COLUMN developers.company_name IS '会社名/サービス名';
  `);
};

exports.down = (pgm) => {
  // products テーブルからカラム削除
  pgm.dropIndex('products', ['developer_id', 'slug'], {
    name: 'idx_products_developer_slug_unique',
  });
  pgm.dropColumn('products', ['slug', 'payment_methods']);

  // developers テーブルからカラム削除
  pgm.dropColumn('developers', [
    'default_success_url',
    'default_cancel_url',
    'default_locale',
    'default_currency',
    'default_payment_methods',
    'callback_url',
    'callback_secret',
    'company_name',
  ]);
};
