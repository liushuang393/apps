import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// ChatGPT ウィジェット用 Vite 設定
// - 単一 JS ファイルとして出力（MCP サーバーから配信するため）
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../server/public/widget',
    rollupOptions: {
      output: {
        entryFileNames: 'app.js',
        chunkFileNames: 'app-[hash].js',
        assetFileNames: 'app[extname]',
      },
    },
  },
  server: {
    port: 5173,
    // 開発時は MCP サーバーへプロキシ
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
})
