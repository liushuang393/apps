/**
 * データベース接続テストスクリプト
 * 目的: ローカル環境でデータベース接続を確認する
 * 実行方法: npx ts-node scripts/test-db-connection.ts
 */

import { pool, testConnection } from '../src/config/database.config';

async function main(): Promise<void> {
  console.log('='.repeat(60));
  console.log('データベース接続テスト');
  console.log('='.repeat(60));
  console.log(`接続文字列: ${process.env.DATABASE_URL || '未設定'}`);
  console.log('');

  try {
    // 1. 接続テスト
    console.log('1. 接続テスト実行中...');
    const connected = await testConnection();
    
    if (!connected) {
      console.error('❌ データベース接続に失敗しました');
      process.exit(1);
    }
    
    console.log('✅ データベース接続成功');
    console.log('');

    // 2. 簡単なクエリテスト
    console.log('2. クエリテスト実行中...');
    const result = await pool.query('SELECT NOW() as current_time, version() as pg_version');
    console.log(`✅ クエリ成功`);
    console.log(`   現在時刻: ${result.rows[0].current_time}`);
    console.log(`   PostgreSQL バージョン: ${result.rows[0].pg_version.split(' ')[0]} ${result.rows[0].pg_version.split(' ')[1]}`);
    console.log('');

    // 3. テーブル一覧確認
    console.log('3. テーブル一覧確認中...');
    const tablesResult = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `);
    console.log(`✅ ${tablesResult.rows.length} 個のテーブルが見つかりました:`);
    tablesResult.rows.forEach((row, index) => {
      console.log(`   ${index + 1}. ${row.table_name}`);
    });
    console.log('');

    // 4. 接続プール情報
    console.log('4. 接続プール情報:');
    console.log(`   - 総接続数: ${pool.totalCount}`);
    console.log(`   - アイドル接続数: ${pool.idleCount}`);
    console.log(`   - 待機中の接続数: ${pool.waitingCount}`);
    console.log('');

    console.log('='.repeat(60));
    console.log('✅ すべてのテストが成功しました！');
    console.log('='.repeat(60));

    await pool.end();
    process.exit(0);
  } catch (error) {
    const err = error as Error;
    console.error('='.repeat(60));
    console.error('❌ エラーが発生しました');
    console.error('='.repeat(60));
    console.error(`エラーメッセージ: ${err.message}`);
    if (err.stack) {
      console.error(`スタックトレース:\n${err.stack}`);
    }
    console.error('');
    console.error('確認事項:');
    console.error('1. Docker コンテナが起動しているか: docker-compose ps');
    console.error('2. DATABASE_URL が正しく設定されているか: api/.env を確認');
    console.error('3. データベースがマイグレーション済みか: npm run migrate');
    console.error('='.repeat(60));
    
    await pool.end().catch(() => {});
    process.exit(1);
  }
}

// 実行
void main();
