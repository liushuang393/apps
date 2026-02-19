import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { config } from './config';
import { logger } from './utils/logger';
import { apiRateLimiter } from './middleware';
import apiRoutes from './routes';

/**
 * ForgePay — OpenAI External Checkout Flow 用の薄い連携レイヤー
 *
 * 役割:
 * 1. purchase_intent_id <-> Stripe Checkout Session マッピング
 * 2. Unlock Token (JWT) 発行/検証
 * 3. Entitlement 状態管理
 * 4. Stripe Webhook 受信（冪等性付き）
 *
 * 通貨・クーポン・請求書・税金・不正防止は全て Stripe に委譲。
 * 管理画面は Stripe Dashboard を使用。
 * 顧客ポータルは Stripe Customer Portal を使用。
 */

const app: Application = express();

// セキュリティミドルウェア
app.use(helmet());

// CORS 設定
app.use(
  cors({
    origin: config.app.env === 'production' ? [] : '*',
    credentials: true,
  })
);

// Cookie パーサー
app.use(cookieParser());

// Webhook エンドポイントは署名検証のため raw body が必要
app.use('/api/v1/webhooks/stripe', express.raw({ type: 'application/json' }));

// その他のルートの body パーシング
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ヘルスチェック
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: config.app.env,
    version: 'slim', // 薄いレイヤーバージョン
  });
});

// API ドキュメント（開発環境のみ）
// 本番環境では /docs は 404 になり、API 構造が外部に公開されない
if (config.app.env !== 'production') {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const swaggerUi = require('swagger-ui-express') as typeof import('swagger-ui-express');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { swaggerSpec, swaggerOptions } = require('./config/swagger') as typeof import('./config/swagger');
  app.use('/docs', swaggerUi.serve);
  app.get('/docs', swaggerUi.setup(swaggerSpec, swaggerOptions));
}

// レート制限を API ルートに適用
app.use('/api/v1', apiRateLimiter);

// API ルート
app.use('/api/v1', apiRoutes);

// 決済成功ページ（フォールバック）
app.get('/payment/success', (_req: Request, res: Response) => {
  res.send(renderSimplePage(
    'お支払いが完了しました',
    'ご購入ありがとうございます。確認メールをお送りしましたのでご確認ください。',
    '#f0fdf4',
    '#16a34a'
  ));
});

// 決済キャンセルページ（フォールバック）
app.get('/payment/cancel', (_req: Request, res: Response) => {
  res.send(renderSimplePage(
    'お支払いがキャンセルされました',
    'お支払いはキャンセルされました。料金は発生していません。',
    '#f7f8fa',
    '#666'
  ));
});

// 404 ハンドラ
app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: {
      code: 'not_found',
      message: `Cannot ${req.method} ${req.path}`,
      type: 'invalid_request_error',
    },
  });
});

// グローバルエラーハンドラ
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  logger.error('未処理エラー', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  res.status(500).json({
    error: {
      code: 'internal_error',
      message: config.app.env === 'development' ? err.message : 'An unexpected error occurred',
      type: 'api_error',
    },
  });
});

/**
 * シンプルな HTML ページ生成ヘルパー
 */
function renderSimplePage(title: string, message: string, bgColor: string, titleColor: string): string {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - ForgePay</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Hiragino Sans', sans-serif;
      background: ${bgColor};
      display: flex; align-items: center; justify-content: center; min-height: 100vh;
      color: #1a1a2e;
    }
    .card {
      background: white; border-radius: 12px; padding: 48px; max-width: 480px;
      width: 90%; text-align: center; box-shadow: 0 2px 12px rgba(0,0,0,0.08);
    }
    h1 { font-size: 22px; margin-bottom: 12px; font-weight: 600; color: ${titleColor}; }
    p { color: #666; font-size: 15px; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;
}

export default app;
