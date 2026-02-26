import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Vite 設定ファイル
 *
 * ポート/IP変更は .env（ルート）の BACKEND_PORT / FRONTEND_PORT のみ編集すればよい。
 * このファイルにハードコードされたポート番号は存在しない。
 *
 * 環境変数（Docker: docker-compose.yml から注入 / ローカル: frontend/.env から読み込み）:
 * - VITE_API_URL       : クライアント側APIのURL（空=相対パス使用→Viteプロキシ経由）
 * - VITE_WS_URL        : クライアント側WebSocketのURL（空=自動検出）
 * - VITE_PORT          : 開発サーバーのポート（Docker内部=5173固定、ローカル=FRONTEND_PORT）
 * - VITE_BACKEND_PORT  : ローカル開発用バックエンドポート（Viteプロキシ転送先）
 *
 * プロキシ設定（ブラウザが相対パス /api, /ws を送信した場合のみ使用）:
 * - VITE_API_URLが未設定 = ローカル開発 → localhost:VITE_BACKEND_PORT へ転送
 * - VITE_API_URLが設定済み = Docker環境 → backend:8000（内部固定ポート）へ転送
 *   ※ Docker環境ではVITE_API_URLが設定されるためブラウザは絶対URLで通信し、
 *      このプロキシ設定は実際には使用されない
 */
export default defineConfig(({ mode }) => {
  // .envファイルから環境変数を読み込み（ルートではなくfrontendディレクトリの.env）
  const fileEnv = loadEnv(mode, process.cwd(), '');

  // クライアント側のAPI URL（ブラウザからのアクセス用）
  // 空の場合は相対パス /api を使用し、Vite proxy で転送
  const clientApiUrl = process.env['VITE_API_URL'] || fileEnv.VITE_API_URL || '';
  const clientWsUrl = process.env['VITE_WS_URL'] || fileEnv.VITE_WS_URL || '';

  // ローカル開発用バックエンドポート（.envのBACKEND_PORTに合わせて設定）
  // Dockerでは VITE_API_URL が設定されるためこの値は使用されない
  const backendPort = process.env['VITE_BACKEND_PORT'] || fileEnv.VITE_BACKEND_PORT || '8090';

  // プロキシターゲット設定:
  // - VITE_API_URLが未設定（ローカル開発）: localhost:backendPort へ転送
  // - VITE_API_URLが設定済み（Docker）: backend:8000（内部固定ポート）へ転送
  const isDockerEnv = clientApiUrl !== '';
  const proxyTarget = isDockerEnv ? 'http://backend:8000' : `http://localhost:${backendPort}`;
  const wsProxyTarget = isDockerEnv ? 'ws://backend:8000' : `ws://localhost:${backendPort}`;

  // 開発サーバーポート（VITE_PORT環境変数から取得。Docker内部=5173、ローカル=FRONTEND_PORT）
  const devPort = parseInt(process.env['VITE_PORT'] || fileEnv.VITE_PORT || '5173', 10);

  return {
    plugins: [react()],
    // クライアントコードに環境変数を注入（空の場合は相対パス使用）
    define: {
      'import.meta.env.VITE_API_URL': JSON.stringify(clientApiUrl),
      'import.meta.env.VITE_WS_URL': JSON.stringify(clientWsUrl),
    },
    server: {
      port: devPort,
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
