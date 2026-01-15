import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Vite 設定ファイル
 *
 * 環境変数から設定を読み込み、ハードコードを排除。
 * Docker環境変数（process.env）と.envファイル両方をサポート。
 *
 * 環境変数:
 * - VITE_API_URL: バックエンドAPIのURL（デフォルト: http://localhost:8000）
 * - VITE_WS_URL: WebSocketのURL（デフォルト: ws://localhost:8000）
 * - VITE_PORT: 開発サーバーのポート（デフォルト: 5173）
 */
export default defineConfig(({ mode }) => {
  // .envファイルから環境変数を読み込み
  const fileEnv = loadEnv(mode, process.cwd(), '');

  // Docker環境変数（process.env）を優先、なければ.envファイル、最後にデフォルト
  const apiUrl = process.env.VITE_API_URL || fileEnv.VITE_API_URL || 'http://localhost:8000';
  const wsUrl = process.env.VITE_WS_URL || fileEnv.VITE_WS_URL || 'ws://localhost:8000';
  const port = parseInt(process.env.VITE_PORT || fileEnv.VITE_PORT || '5173', 10);

  console.log('[Vite Config] API URL:', apiUrl);
  console.log('[Vite Config] WS URL:', wsUrl);

  return {
    plugins: [react()],
    // クライアントコードに環境変数を注入
    define: {
      'import.meta.env.VITE_API_URL': JSON.stringify(apiUrl),
      'import.meta.env.VITE_WS_URL': JSON.stringify(wsUrl),
    },
    server: {
      port,
      host: '0.0.0.0',
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
