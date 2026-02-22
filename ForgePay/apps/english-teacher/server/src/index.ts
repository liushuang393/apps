import 'dotenv/config';
import { createApp } from './app';
import { initializeSchema } from './db/client';

const app = createApp();
const PORT = parseInt(process.env.PORT ?? '3000', 10);

async function main(): Promise<void> {
  console.log('データベースを初期化中...');
  await initializeSchema();
  console.log('✓ データベース準備完了');

  app.listen(PORT, () => {
    console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  English Teacher MCP Server
  ポート: ${PORT}
  MCP エンドポイント: http://localhost:${PORT}/mcp
  コールバック: http://localhost:${PORT}/callback/forgepay
  ヘルスチェック: http://localhost:${PORT}/health
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    `);
  });
}

main().catch((err) => {
  console.error('サーバー起動エラー:', err);
  process.exit(1);
});
