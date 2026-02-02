/**
 * テストデータヘルパー
 * 目的: テストで使用するデータを作成・削除するためのヘルパー関数を提供する
 * I/O: テストIDを引数に取り、一意のテストデータを作成・削除する
 * 注意点: テストごとに一意のIDを使用し、テスト後にデータを削除する
 */

import { pool } from '../../../src/config/database.config';
import { UserRole } from '../../../src/models/user.entity';

/**
 * 一意のテストIDを生成する
 * 目的: テストごとに一意のIDを生成し、テストデータの衝突を防ぐ
 */
export function generateTestId(): string {
  return `test-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * テスト用ユーザーを作成する
 * 目的: テストで使用するユーザーデータを作成する
 * I/O: テストIDとユーザー情報を引数に取り、ユーザーを作成する
 * 注意点: テスト後に削除する必要がある
 */
export async function createTestUser(
  testId: string,
  overrides?: {
    user_id?: string;
    email?: string;
    display_name?: string;
    role?: UserRole;
    firebase_uid?: string;
  }
): Promise<string> {
  const client = await pool.connect();
  try {
    const userId = overrides?.user_id || `${testId}-user`;
    const email = overrides?.email || `${testId}@test.example.com`;
    const displayName = overrides?.display_name || `Test User ${testId}`;
    const role = overrides?.role || UserRole.CUSTOMER;
    const firebaseUid = overrides?.firebase_uid || userId;

    await client.query(
      `INSERT INTO users (user_id, firebase_uid, email, display_name, role, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
       ON CONFLICT (user_id) DO NOTHING`,
      [userId, firebaseUid, email, displayName, role]
    );

    return userId;
  } finally {
    client.release();
  }
}

/**
 * テスト用ユーザーを削除する
 */
export async function deleteTestUser(userId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('DELETE FROM users WHERE user_id = $1', [userId]);
  } finally {
    client.release();
  }
}

/**
 * テスト用キャンペーンを作成する
 */
export async function createTestCampaign(
  testId: string,
  creatorId: string,
  overrides?: {
    campaign_id?: string;
    name?: string;
    base_length?: number;
  }
): Promise<string> {
  const client = await pool.connect();
  try {
    const campaignId = overrides?.campaign_id || `${testId}-campaign`;
    const name = overrides?.name || `Test Campaign ${testId}`;
    const baseLength = overrides?.base_length || 3;

    await client.query('BEGIN');

    // キャンペーンを作成
    await client.query(
      `INSERT INTO campaigns (campaign_id, name, description, base_length, positions_total, status, creator_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'draft', $6, NOW(), NOW())`,
      [campaignId, name, `Test Description ${testId}`, baseLength, baseLength * (baseLength + 1) / 2, creatorId]
    );

    // レイヤーを作成
    for (let layer = 1; layer <= baseLength; layer++) {
      await client.query(
        `INSERT INTO layers (layer_id, campaign_id, layer_number, price, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW(), NOW())`,
        [`${campaignId}-layer-${layer}`, campaignId, layer, 100 * layer]
      );
    }

    await client.query('COMMIT');

    return campaignId;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * テスト用キャンペーンを削除する
 */
export async function deleteTestCampaign(campaignId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 外部キー制約を考慮して削除順序を守る
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
 * テストで作成したすべてのデータを削除する
 * 目的: テストIDに基づいて、テストで作成したすべてのデータを削除する
 */
export async function cleanupTestData(testId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 外部キー制約を考慮して削除順序を守る
    await client.query('DELETE FROM lottery_results WHERE campaign_id LIKE $1 OR user_id LIKE $1', [`${testId}-%`]);
    await client.query('DELETE FROM purchase_items WHERE purchase_id IN (SELECT purchase_id FROM purchases WHERE purchase_id LIKE $1 OR user_id LIKE $1)', [`${testId}-%`]);
    await client.query('DELETE FROM payment_transactions WHERE purchase_id IN (SELECT purchase_id FROM purchases WHERE purchase_id LIKE $1 OR user_id LIKE $1)', [`${testId}-%`]);
    await client.query('DELETE FROM purchases WHERE purchase_id LIKE $1 OR user_id LIKE $1', [`${testId}-%`]);
    await client.query('DELETE FROM positions WHERE campaign_id IN (SELECT campaign_id FROM campaigns WHERE campaign_id LIKE $1)', [`${testId}-%`]);
    await client.query('DELETE FROM prizes WHERE campaign_id IN (SELECT campaign_id FROM campaigns WHERE campaign_id LIKE $1)', [`${testId}-%`]);
    await client.query('DELETE FROM layers WHERE campaign_id IN (SELECT campaign_id FROM campaigns WHERE campaign_id LIKE $1)', [`${testId}-%`]);
    await client.query('DELETE FROM campaigns WHERE campaign_id LIKE $1', [`${testId}-%`]);
    await client.query('DELETE FROM notifications WHERE user_id LIKE $1', [`${testId}-%`]);
    await client.query('DELETE FROM users WHERE user_id LIKE $1', [`${testId}-%`]);

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
