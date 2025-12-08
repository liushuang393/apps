import { pool } from '../config/database.config';
import {
  User,
  CreateUserDto,
  UpdateUserDto,
  UserProfile,
  UserStats,
  mapRowToUser,
  mapUserToProfile,
} from '../models/user.entity';
import logger from '../utils/logger.util';

/**
 * Database row types for user queries
 */
interface UserStatsRow {
  total_purchases: number;
  total_spent: number;
  prizes_won: number;
}

interface CountRow {
  count: string;
}

/**
 * User service for managing user accounts
 */
export class UserService {
  /**
   * Create a new user
   */
  async createUser(dto: CreateUserDto): Promise<User> {
    try {
      const roleValue = dto.role || 'customer';  // デフォルトは'customer'（一般顧客）
      logger.info(`Creating user with role: ${roleValue} (dto.role: ${dto.role})`);

      const { rows } = await pool.query<User>(
        `INSERT INTO users (user_id, firebase_uid, email, display_name, photo_url, fcm_token, role, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
         RETURNING *`,
        [
          dto.user_id,
          dto.user_id,  // firebase_uid と user_id は同じ値を使用
          dto.email,
          dto.display_name || null,
          dto.avatar_url || null,  // Map avatar_url to photo_url
          dto.fcm_token || null,
          roleValue,
        ]
      );

      const user = mapRowToUser(rows[0]);
      logger.info(`User created: ${user.user_id}`);
      return user;
    } catch (error: unknown) {
      const errorCode = error && typeof error === 'object' && 'code' in error ? (error as { code: string }).code : undefined;
      if (errorCode === '23505') {
        // Unique constraint violation
        logger.warn(`User already exists: ${dto.user_id}`);
        throw new Error('USER_ALREADY_EXISTS');
      }
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to create user', { error: errorMessage, dto });
      throw error;
    }
  }

  /**
   * Get user by ID
   */
  async getUserById(userId: string): Promise<User | null> {
    try {
      const { rows } = await pool.query<User>(
        'SELECT * FROM users WHERE user_id = $1',
        [userId]
      );

      if (rows.length === 0) {
        return null;
      }

      return mapRowToUser(rows[0]);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to get user by ID', { error: errorMessage, userId });
      throw error;
    }
  }

  /**
   * Get user by email
   */
  async getUserByEmail(email: string): Promise<User | null> {
    try {
      const { rows } = await pool.query<User>(
        'SELECT * FROM users WHERE email = $1',
        [email]
      );

      if (rows.length === 0) {
        return null;
      }

      return mapRowToUser(rows[0]);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to get user by email', { error: errorMessage, email });
      throw error;
    }
  }

  /**
   * Update user profile
   */
  async updateUser(userId: string, dto: UpdateUserDto): Promise<User> {
    try {
      const updates: string[] = [];
      const values: (string | boolean | null)[] = [];
      let paramIndex = 1;

      if (dto.display_name !== undefined) {
        updates.push(`display_name = $${paramIndex++}`);
        values.push(dto.display_name);
      }

      if (dto.avatar_url !== undefined) {
        updates.push(`photo_url = $${paramIndex++}`);  // Map avatar_url to photo_url
        values.push(dto.avatar_url);
      }

      if (dto.fcm_token !== undefined) {
        updates.push(`fcm_token = $${paramIndex++}`);
        values.push(dto.fcm_token);
      }

      if (dto.notification_enabled !== undefined) {
        updates.push(`notification_enabled = $${paramIndex++}`);
        values.push(dto.notification_enabled);
      }

      if (dto.role !== undefined) {
        updates.push(`role = $${paramIndex++}`);
        values.push(dto.role);
      }

      if (updates.length === 0) {
        // No updates provided, return existing user
        const user = await this.getUserById(userId);
        if (!user) {
          throw new Error('USER_NOT_FOUND');
        }
        return user;
      }

      updates.push(`updated_at = NOW()`);
      values.push(userId);

      const query = `
        UPDATE users
        SET ${updates.join(', ')}
        WHERE user_id = $${paramIndex}
        RETURNING *
      `;

      const { rows } = await pool.query<User>(query, values);

      if (rows.length === 0) {
        throw new Error('USER_NOT_FOUND');
      }

      const user = mapRowToUser(rows[0]);
      logger.info(`User updated: ${userId}`);
      return user;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to update user', { error: errorMessage, userId, dto });
      throw error;
    }
  }

  /**
   * Update last login timestamp
   */
  async updateLastLogin(userId: string): Promise<void> {
    try {
      await pool.query(
        'UPDATE users SET last_login_at = NOW() WHERE user_id = $1',
        [userId]
      );
      logger.debug(`Last login updated: ${userId}`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to update last login', { error: errorMessage, userId });
      throw error;
    }
  }

  /**
   * Get user profile (public-safe)
   */
  async getUserProfile(userId: string): Promise<UserProfile | null> {
    const user = await this.getUserById(userId);
    if (!user) {
      return null;
    }
    return mapUserToProfile(user);
  }

  /**
   * Get user statistics
   */
  async getUserStats(userId: string): Promise<UserStats> {
    try {
      // Get basic stats from user table
      const { rows: userRows } = await pool.query<UserStatsRow>(
        'SELECT total_purchases, total_spent, prizes_won FROM users WHERE user_id = $1',
        [userId]
      );

      if (userRows.length === 0) {
        throw new Error('USER_NOT_FOUND');
      }

      const user = userRows[0];

      // Get active campaigns count (campaigns where user has purchases)
      const { rows: campaignRows } = await pool.query<CountRow>(
        `SELECT COUNT(DISTINCT campaign_id) as count
         FROM purchases
         WHERE user_id = $1 AND status IN ('pending', 'processing', 'completed')`,
        [userId]
      );

      const activeCampaigns = Number.parseInt(String(campaignRows[0].count), 10);

      // Calculate win rate
      const totalPurchases = Number.parseInt(String(user.total_purchases), 10);
      const prizesWon = Number.parseInt(String(user.prizes_won), 10);
      const winRate = totalPurchases > 0 ? (prizesWon / totalPurchases) * 100 : 0;

      return {
        total_purchases: totalPurchases,
        total_spent: Number.parseInt(String(user.total_spent), 10),
        prizes_won: prizesWon,
        active_campaigns: activeCampaigns,
        win_rate: Math.round(winRate * 100) / 100, // Round to 2 decimal places
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to get user stats', { error: errorMessage, userId });
      throw error;
    }
  }

  /**
   * Delete user (soft delete by deactivating)
   */
  async deleteUser(userId: string): Promise<void> {
    try {
      // For now, we'll mark the user as deleted by clearing sensitive data
      await pool.query(
        `UPDATE users
         SET email = CONCAT('deleted_', user_id, '@deleted.local'),
             display_name = 'Deleted User',
             avatar_url = NULL,
             fcm_token = NULL,
             notification_enabled = FALSE,
             updated_at = NOW()
         WHERE user_id = $1`,
        [userId]
      );

      logger.info(`User soft deleted: ${userId}`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to delete user', { error: errorMessage, userId });
      throw error;
    }
  }

  /**
   * List all users (admin only)
   */
  async listUsers(limit: number = 50, offset: number = 0): Promise<User[]> {
    try {
      const { rows } = await pool.query(
        `SELECT * FROM users
         ORDER BY created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      );

      return rows.map(mapRowToUser);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to list users', { error: errorMessage });
      throw error;
    }
  }

  /**
   * Get total user count
   */
  async getUserCount(): Promise<number> {
    try {
      const { rows } = await pool.query<CountRow>('SELECT COUNT(*) as count FROM users');
      return Number.parseInt(String(rows[0].count), 10);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to get user count', { error: errorMessage });
      throw error;
    }
  }

  /**
   * Check if admin user exists
   * 目的: 管理者ユーザーが存在するかチェック
   * I/O: 管理者ユーザーの存在有無を返す
   */
  async hasAdminUser(): Promise<boolean> {
    try {
      const { rows } = await pool.query<CountRow>(
        'SELECT COUNT(*) as count FROM users WHERE role = $1',
        ['admin']
      );
      const count = Number.parseInt(String(rows[0].count), 10);
      return count > 0;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to check admin user', { error: errorMessage });
      throw error;
    }
  }
}

export default new UserService();
