#!/usr/bin/env ts-node
/**
 * ユーザーロール更新スクリプト
 * 目的: 指定されたユーザーIDのロールを更新する
 * 使用方法: ts-node scripts/update-user-role.ts <user_id> <role>
 * 例: ts-node scripts/update-user-role.ts 1bB4HReqaeW7TCuBDdaONHbHFes1 admin
 */

import { pool } from '../src/config/database.config';
import * as dotenv from 'dotenv';

dotenv.config();

/**
 * ユーザーロールを更新する
 * @param userId - 更新するユーザーID
 * @param role - 新しいロール ('customer' | 'admin')
 */
async function updateUserRole(userId: string, role: string): Promise<void> {
  const client = await pool.connect();
  
  try {
    // バリデーション
    if (!['customer', 'admin'].includes(role)) {
      throw new Error(`Invalid role: ${role}. Must be 'customer' or 'admin'`);
    }

    console.log(`\n=== ユーザーロール更新 ===`);
    console.log(`ユーザーID: ${userId}`);
    console.log(`新しいロール: ${role}`);
    
    // トランザクション開始
    await client.query('BEGIN');
    
    // 現在のユーザー情報を確認
    const checkResult = await client.query(
      'SELECT user_id, email, role, display_name FROM users WHERE user_id = $1',
      [userId]
    );
    
    if (checkResult.rows.length === 0) {
      throw new Error(`ユーザーが見つかりません: ${userId}`);
    }
    
    const currentUser = checkResult.rows[0] as {
      user_id: string;
      email: string;
      role: string;
      display_name: string | null;
    };
    
    console.log(`\n現在のユーザー情報:`);
    console.log(`  Email: ${currentUser.email}`);
    console.log(`  現在のロール: ${currentUser.role}`);
    console.log(`  表示名: ${currentUser.display_name || '(なし)'}`);
    
    if (currentUser.role === role) {
      console.log(`\n⚠️  ユーザーは既に '${role}' ロールです。`);
      await client.query('ROLLBACK');
      return;
    }
    
    // ロールを更新
    console.log(`\nロールを更新中...`);
    const updateResult = await client.query(
      'UPDATE users SET role = $1, updated_at = NOW() WHERE user_id = $2 RETURNING *',
      [role, userId]
    );
    
    const updatedUser = updateResult.rows[0] as { role: string };
    console.log(`\n✅ ロール更新成功！`);
    console.log(`  更新後のロール: ${updatedUser.role}`);
    
    // コミット
    await client.query('COMMIT');
    console.log(`\n✅ トランザクション完了`);
    
  } catch (error) {
    await client.query('ROLLBACK');
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`\n❌ エラーが発生しました:`, errorMessage);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * メイン処理
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.error('使用方法: ts-node scripts/update-user-role.ts <user_id> <role>');
    console.error('例: ts-node scripts/update-user-role.ts 1bB4HReqaeW7TCuBDdaONHbHFes1 admin');
    process.exit(1);
  }
  
  const [userId, role] = args;
  
  try {
    await updateUserRole(userId, role);
    process.exit(0);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('スクリプト実行失敗:', errorMessage);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
