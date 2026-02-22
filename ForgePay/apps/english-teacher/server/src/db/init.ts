import 'dotenv/config';
import { initializeSchema } from './client';

/**
 * データベーススキーマを初期化するスクリプト
 * npm run db:init で実行する
 */
async function main(): Promise<void> {
  console.log('データベーススキーマを初期化中...');
  await initializeSchema();
  console.log('✓ スキーマ初期化完了');
  process.exit(0);
}

main().catch((err) => {
  console.error('スキーマ初期化に失敗:', err);
  process.exit(1);
});
