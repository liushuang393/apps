import { QueryResultRow } from 'pg';

/**
 * User entity representing a user in the system
 */
export interface User {
  user_id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  role: UserRole;
  fcm_token: string | null;
  notification_enabled: boolean;
  total_purchases: number;
  total_spent: number;
  prizes_won: number;
  created_at: Date;
  updated_at: Date;
  last_login_at: Date | null;
}

/**
 * ユーザーの役割定義
 * 目的: システム内のユーザー権限を管理
 * 注意点: CUSTOMER=一般顧客, ADMIN=管理者
 */
export enum UserRole {
  CUSTOMER = 'customer',
  ADMIN = 'admin',
}

/**
 * User creation payload
 */
export interface CreateUserDto {
  user_id: string; // Firebase UID
  email: string;
  display_name?: string;
  avatar_url?: string;
  fcm_token?: string;
  role?: 'customer' | 'admin'; // 役割指定（オプション、デフォルトはcustomer）
}

/**
 * User update payload
 */
export interface UpdateUserDto {
  display_name?: string;
  avatar_url?: string;
  fcm_token?: string;
  notification_enabled?: boolean;
  role?: 'customer' | 'admin'; // 管理者のみ更新可能
}

/**
 * User profile response
 */
export interface UserProfile {
  user_id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  role: UserRole;
  notification_enabled: boolean;
  total_purchases: number;
  total_spent: number;
  prizes_won: number;
  created_at: Date;
  last_login_at: Date | null;
}

/**
 * User statistics
 */
export interface UserStats {
  total_purchases: number;
  total_spent: number;
  prizes_won: number;
  active_campaigns: number;
  win_rate: number; // Percentage
}

/**
 * Map database row to User entity
 */
export function mapRowToUser(row: QueryResultRow): User {
  return {
    user_id: String(row.user_id),
    email: String(row.email),
    display_name: row.display_name ? String(row.display_name) : null,
    avatar_url: row.photo_url ? String(row.photo_url) : null,  // Map photo_url to avatar_url
    role: row.role as UserRole,
    fcm_token: row.fcm_token ? String(row.fcm_token) : null,
    notification_enabled: Boolean(row.notification_enabled),
    total_purchases: Number.parseInt(String(row.total_purchases), 10),
    total_spent: Number.parseInt(String(row.total_spent), 10),
    prizes_won: Number.parseInt(String(row.prizes_won), 10),
    created_at: new Date(row.created_at as string | number | Date),
    updated_at: new Date(row.updated_at as string | number | Date),
    last_login_at: row.last_login_at ? new Date(row.last_login_at as string | number | Date) : null,
  };
}

/**
 * Map User entity to UserProfile (excludes sensitive fields)
 */
export function mapUserToProfile(user: User): UserProfile {
  return {
    user_id: user.user_id,
    email: user.email,
    display_name: user.display_name,
    avatar_url: user.avatar_url,
    role: user.role,
    notification_enabled: user.notification_enabled,
    total_purchases: user.total_purchases,
    total_spent: user.total_spent,
    prizes_won: user.prizes_won,
    created_at: user.created_at,
    last_login_at: user.last_login_at,
  };
}

export default {
  UserRole,
  mapRowToUser,
  mapUserToProfile,
};
