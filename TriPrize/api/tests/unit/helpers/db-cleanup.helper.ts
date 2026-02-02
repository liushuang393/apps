/**
 * データベースクリーンアップヘルパー
 * 目的: テスト後にデータベースをクリーンアップし、テストを反復実行可能にする
 * I/O: テストで作成したデータを削除する
 * 注意点: 外部キー制約を考慮して削除順序を守る
 */

import { pool } from '../../../src/config/database.config';

/**
 * テストで使用したデータを削除する
 * 目的: テストを反復実行可能にするため、テストで作成したデータを削除する
 * I/O: テストIDを引数に取り、該当するデータを削除する
 * 注意点: 外部キー制約を考慮して削除順序を守る（子テーブル→親テーブル）
 */
export async function cleanupTestData(testId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 外部キー制約を考慮して削除順序を守る
    // 子テーブルから削除
    await client.query('DELETE FROM lottery_results WHERE campaign_id LIKE $1', [`test-${testId}-%`]);
    await client.query('DELETE FROM purchase_items WHERE purchase_id IN (SELECT purchase_id FROM purchases WHERE purchase_id LIKE $1)', [`test-${testId}-%`]);
    await client.query('DELETE FROM payment_transactions WHERE purchase_id IN (SELECT purchase_id FROM purchases WHERE purchase_id LIKE $1)', [`test-${testId}-%`]);
    await client.query('DELETE FROM purchases WHERE purchase_id LIKE $1', [`test-${testId}-%`]);
    await client.query('DELETE FROM positions WHERE campaign_id IN (SELECT campaign_id FROM campaigns WHERE campaign_id LIKE $1)', [`test-${testId}-%`]);
    await client.query('DELETE FROM prizes WHERE campaign_id IN (SELECT campaign_id FROM campaigns WHERE campaign_id LIKE $1)', [`test-${testId}-%`]);
    await client.query('DELETE FROM layers WHERE campaign_id IN (SELECT campaign_id FROM campaigns WHERE campaign_id LIKE $1)', [`test-${testId}-%`]);
    await client.query('DELETE FROM campaigns WHERE campaign_id LIKE $1', [`test-${testId}-%`]);
    await client.query('DELETE FROM notifications WHERE user_id LIKE $1', [`test-${testId}-%`]);
    await client.query('DELETE FROM users WHERE user_id LIKE $1', [`test-${testId}-%`]);

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * 特定のユーザーIDに関連するテストデータを削除する
 */
export async function cleanupUserTestData(userId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query('DELETE FROM lottery_results WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM purchase_items WHERE purchase_id IN (SELECT purchase_id FROM purchases WHERE user_id = $1)', [userId]);
    await client.query('DELETE FROM payment_transactions WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM purchases WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM notifications WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM users WHERE user_id = $1', [userId]);

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * 特定のキャンペーンIDに関連するテストデータを削除する
 */
export async function cleanupCampaignTestData(campaignId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query('DELETE FROM lottery_results WHERE campaign_id = $1', [campaignId]);
    await client.query('DELETE FROM purchase_items WHERE purchase_id IN (SELECT purchase_id FROM purchases WHERE campaign_id = $1)', [campaignId]);
    await client.query('DELETE FROM payment_transactions WHERE purchase_id IN (SELECT purchase_id FROM purchases WHERE campaign_id = $1)', [campaignId]);
    await client.query('DELETE FROM purchases WHERE campaign_id = $1', [campaignId]);
    await client.query('DELETE FROM positions WHERE campaign_id = $1', [campaignId]);
    await client.query('DELETE FROM prizes WHERE campaign_id = $1', [campaignId]);
    await client.query('DELETE FROM layers WHERE campaign_id = $1', [campaignId]);
    await client.query('DELETE FROM campaigns WHERE campaign_id = $1', [campaignId]);

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * 一意のテストIDを生成する
 * 目的: テストごとに一意のIDを生成し、テストデータの衝突を防ぐ
 */
export function generateTestId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}
