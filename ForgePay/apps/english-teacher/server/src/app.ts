import express from 'express';
import cors from 'cors';
import path from 'path';
import rateLimit from 'express-rate-limit';

import { handleMcpRequest, handleMcpGet, handleMcpDelete } from './mcp/server';
import checkoutRouter from './routes/checkout';
import callbackRouter from './routes/callback';
import apiRouter from './routes/api';

// /api/ask 用レートリミッター: 1 分間に最大 10 リクエスト
// OpenAI API コスト爆発防止と乱用対策
// テスト環境ではレートリミッターをスキップ（テスト間の状態汚染を防ぐ）
const askRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 分
  max: parseInt(process.env.ASK_RATE_LIMIT_MAX ?? '10', 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'リクエストが多すぎます。1 分間に 10 回まで質問できます。しばらくしてから再試行してください。',
  },
  // テスト環境ではスキップ（全リクエストを通過させる）
  skip: () => process.env.NODE_ENV === 'test',
});

/**
 * Express アプリケーションを生成して返す
 * index.ts からはこれを呼び出して listen() する
 * テストからはこれを直接インポートして supertest に渡す
 */
export function createApp(): express.Application {
  const app = express();

  // ─── CORS ──────────────────────────────────────────────────────────────────
  app.use(
    cors({
      origin: [
        'https://chat.openai.com',
        'https://chatgpt.com',
        'http://localhost:3002',
        'http://localhost:5173',
      ],
      methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'mcp-session-id', 'Accept'],
    }),
  );

  // JSON パース
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));

  // ─── 静的ファイル配信 ────────────────────────────────────────────────────
  const widgetPath = path.join(__dirname, '..', 'public', 'widget');
  app.use('/widget', express.static(widgetPath));

  // ─── MCP エンドポイント ─────────────────────────────────────────────────
  app.post('/mcp', handleMcpRequest);
  app.get('/mcp', handleMcpGet);
  app.delete('/mcp', handleMcpDelete);

  // ─── REST エンドポイント ────────────────────────────────────────────────
  // /api/ask にのみレートリミッター適用（/api/status は除外）
  app.use('/api/ask', askRateLimiter);
  app.use('/api', apiRouter);
  app.use('/checkout', checkoutRouter);
  app.use('/callback/forgepay', callbackRouter);

  // ─── ヘルスチェック ─────────────────────────────────────────────────────
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'english-teacher-mcp-server',
      timestamp: new Date().toISOString(),
    });
  });

  return app;
}
