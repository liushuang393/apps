import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Vite 設定ファイル
 *
 * 環境変数から設定を読み込み、ハードコードを排除。
 * Docker環境変数（process.env）と.envファイル両方をサポート。
 *
 * 環境変数:
 * - VITE_API_URL: クライアント側APIのURL（デフォルト: 空 = 相対パス使用）
 * - VITE_WS_URL: クライアント側WebSocketのURL（デフォルト: 空 = 自動検出）
 * - VITE_PORT: 開発サーバーのポート（デフォルト: 5173）
 *
 * プロキシ設定:
 * - Docker環境ではbackendサービス名を使用
 * - ローカル環境ではlocalhost:8000を使用
 */
export default defineConfig(({ mode }) => {
  // .envファイルから環境変数を読み込み
  const fileEnv = loadEnv(mode, process.cwd(), '');

  // クライアント側のAPI URL（ブラウザからのアクセス用）
  // 空の場合は相対パス/apiを使用し、Vite proxyで転送
  const clientApiUrl = process.env['VITE_API_URL'] || fileEnv.VITE_API_URL || '';
  const clientWsUrl = process.env['VITE_WS_URL'] || fileEnv.VITE_WS_URL || '';

  // Viteサーバー側のプロキシターゲット（コンテナ間通信用）
  // Docker環境ではbackendサービス名、ローカルではlocalhost
  const isDocker = clientApiUrl.includes('://');
  const proxyTarget = isDocker ? 'http://backend:8000' : 'http://localhost:8000';
  const wsProxyTarget = isDocker ? 'ws://backend:8000' : 'ws://localhost:8000';

  return {
    plugins: [react()],
    // クライアントコードに環境変数を注入（空の場合は相対パス使用）
    define: {
      'import.meta.env.VITE_API_URL': JSON.stringify(clientApiUrl),
      'import.meta.env.VITE_WS_URL': JSON.stringify(clientWsUrl),
    },
    server: {
      port: 5173,
      host: '0.0.0.0',
      strictPort: true,
      proxy: {
        '/api': {
          target: proxyTarget,
          changeOrigin: true,
        },
        '/ws': {
          target: wsProxyTarget,
          ws: true,
          changeOrigin: true,
        },
      },
    },
  };
});
