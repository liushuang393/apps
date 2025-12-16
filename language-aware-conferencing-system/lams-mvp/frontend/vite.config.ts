import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Vite 設定ファイル
 *
 * 環境変数から設定を読み込み、ハードコードを排除。
 * .env ファイルで以下の変数を設定可能:
 * - VITE_API_URL: バックエンドAPIのURL（デフォルト: http://localhost:8000）
 * - VITE_WS_URL: WebSocketのURL（デフォルト: ws://localhost:8000）
 * - VITE_PORT: 開発サーバーのポート（デフォルト: 3000）
 */
export default defineConfig(({ mode }) => {
  // 環境変数を読み込み
  const env = loadEnv(mode, process.cwd(), '');

  // デフォルト値（環境変数が設定されていない場合）
  const apiUrl = env.VITE_API_URL || 'http://localhost:8000';
  const wsUrl = env.VITE_WS_URL || 'ws://localhost:8000';
  const port = parseInt(env.VITE_PORT || '3000', 10);

  return {
    plugins: [react()],
    server: {
      port,
      proxy: {
        '/api': {
          target: apiUrl,
          changeOrigin: true,
        },
        '/ws': {
          target: wsUrl,
          ws: true,
        },
      },
    },
  };
});
