import { QueryResultRow } from 'pg';

/**
 * 配送先住所
 * 目的: ユーザーの配送先住所情報を管理
 * 注意点: 日本の住所形式に対応（郵便番号、都道府県、市区町村、番地、建物名）
 */
export interface ShippingAddress {
  postal_code: string | null;
  prefecture: string | null;
  city: string | null;
  address_line1: string | null;
  address_line2: string | null;
}

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
  // 配送先住所
  postal_code: string | null;
  prefecture: string | null;
  city: string | null;
  address_line1: string | null;
  address_line2: string | null;
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
 * 配送先住所更新DTO
 * 目的: ユーザーの配送先住所を更新
 * I/O: 郵便番号、都道府県、市区町村、番地、建物名を受け取る
 */
export interface UpdateAddressDto {
  postal_code: string;
  prefecture: string;
  city: string;
  address_line1: string;
  address_line2?: string;
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
  // 配送先住所
  shipping_address: ShippingAddress | null;
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
 * データベース行をUserエンティティにマップ
 * 目的: データベースの行データをUser型に変換
 * 注意点: 配送先住所フィールドを含む
 */
export function mapRowToUser(row: QueryResultRow): User {
  return {
    user_id: String(row.user_id),
    email: String(row.email),
    display_name: row.display_name ? String(row.display_name) : null,
    avatar_url: row.photo_url ? String(row.photo_url) : null,
    role: row.role as UserRole,
    fcm_token: row.fcm_token ? String(row.fcm_token) : null,
    notification_enabled: Boolean(row.notification_enabled),
    total_purchases: Number.parseInt(String(row.total_purchases), 10),
    total_spent: Number.parseInt(String(row.total_spent), 10),
    prizes_won: Number.parseInt(String(row.prizes_won), 10),
    created_at: new Date(String(row.created_at)),
    updated_at: new Date(String(row.updated_at)),
    last_login_at: row.last_login_at ? new Date(String(row.last_login_at)) : null,
    // 配送先住所
    postal_code: row.postal_code ? String(row.postal_code) : null,
    prefecture: row.prefecture ? String(row.prefecture) : null,
    city: row.city ? String(row.city) : null,
    address_line1: row.address_line1 ? String(row.address_line1) : null,
    address_line2: row.address_line2 ? String(row.address_line2) : null,
  };
}

/**
 * UserエンティティをUserProfileにマップ（機密フィールドを除外）
 * 目的: レスポンス用のプロフィール情報を生成
 * 注意点: fcm_tokenなどの機密情報を含めない
 */
export function mapUserToProfile(user: User): UserProfile {
  // 住所情報をまとめる
  const hasAddress = user.postal_code || user.prefecture || user.city || user.address_line1;
  const shippingAddress: ShippingAddress | null = hasAddress ? {
    postal_code: user.postal_code,
    prefecture: user.prefecture,
    city: user.city,
    address_line1: user.address_line1,
    address_line2: user.address_line2,
  } : null;

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
    shipping_address: shippingAddress,
  };
}

export default {
  UserRole,
  mapRowToUser,
  mapUserToProfile,
};
