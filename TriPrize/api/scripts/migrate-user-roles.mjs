/**
 * データベース移行スクリプト: user役割を更新
 * 目的: 'user' -> 'customer' への移行を実行
 */

import { pool } from './src/config/database.config.js';
import logger from './src/utils/logger.util.js';

async function checkCurrentState() {
  console.log('\n=== 現在の役割分布 ===');
  const { rows } = await pool.query(
    `SELECT role, COUNT(*) as count FROM users GROUP BY role ORDER BY role`
  );
  console.table(rows);
  return rows;
}

async function migrate() {
  const client = await pool.connect();
  
  try {
    console.log('\n=== 移行開始 ===');
    
    // トランザクション開始
    await client.query('BEGIN');
    
    // 1. 既存の'user'役割を'customer'に更新
    console.log('1. 既存のユーザー役割を更新中...');
    const updateResult = await client.query(
      `UPDATE users SET role = 'customer' WHERE role = 'user'`
    );
    console.log(`   ✓ ${updateResult.rowCount} 件のユーザーを更新`);
    
    // 2. 制約を削除
    console.log('2. 既存の役割制約を削除中...');
    await client.query(
      `ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`
    );
    console.log('   ✓ 制約を削除');
    
    // 3. 新しい制約を追加
    console.log('3. 新しい役割制約を追加中...');
    await client.query(
      `ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('customer', 'admin'))`
    );
    console.log('   ✓ 制約を追加');
    
    // 4. デフォルト値を更新
    console.log('4. デフォルト役割を更新中...');
    await client.query(
      `ALTER TABLE users ALTER COLUMN role SET DEFAULT 'customer'`
    );
    console.log('   ✓ デフォルト値を設定');
    
    // コミット
    await client.query('COMMIT');
    console.log('\n✅ 移行成功！');
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('\n❌ 移行失敗:', error);
    throw error;
  } finally {
    client.release();
  }
}

async function verify() {
  console.log('\n=== 移行後の確認 ===');
  
  // 役割分布を確認
  const roles = await checkCurrentState();
  
  // 制約を確認
  console.log('\n=== 制約確認 ===');
  const { rows: constraints } = await pool.query(`
    SELECT 
      conname as constraint_name,
      pg_get_constraintdef(oid) as definition
    FROM pg_constraint
    WHERE conrelid = 'users'::regclass
    AND conname = 'users_role_check'
  `);
  console.table(constraints);
  
  // デフォルト値を確認
  console.log('\n=== デフォルト値確認 ===');
  const { rows: defaults } = await pool.query(`
    SELECT 
      column_name,
      column_default
    FROM information_schema.columns
    WHERE table_name = 'users'
    AND column_name = 'role'
  `);
  console.table(defaults);
  
  return {
    roles,
    constraints,
    defaults
  };
}

async function main() {
  try {
    console.log('🔄 データベース移行ツール');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━');
    
    // 現在の状態を確認
    await checkCurrentState();
    
    // ユーザーに確認を求める
    console.log('\n⚠️  このスクリプトは以下を実行します:');
    console.log('   1. role = "user" を "customer" に変更');
    console.log('   2. CHECK制約を更新');
    console.log('   3. デフォルト値を "customer" に設定');
    console.log('\n続行しますか? (y/n)');
    
    // 自動実行モードの場合
    if (process.argv.includes('--auto')) {
      console.log('自動実行モード: 続行します');
      await migrate();
      await verify();
    } else {
      console.log('対話モードではないため、--autoフラグを付けて実行してください');
    }
    
  } catch (error) {
    console.error('エラーが発生しました:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// 引数チェック
if (process.argv.includes('--check-only')) {
  // 確認のみ
  checkCurrentState().then(() => pool.end());
} else {
  // 移行実行
  main();
}

