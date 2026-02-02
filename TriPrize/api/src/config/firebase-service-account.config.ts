/**
 * Firebase Service Account Configuration
 *
 * 公式のサービスアカウントJSONファイルから設定を読み込む専用モジュール。
 * .envには FIREBASE_SERVICE_ACCOUNT_KEY_PATH のみ設定し、
 * 環境毎に異なるJSONファイルを使用可能。
 *
 * ベストプラクティス：
 * - 公式JSONファイルをそのまま使用（変更に強い）
 * - 環境別のJSONファイルパスを.envで管理
 * - 必須フィールドの検証を実施
 */

import * as fs from 'fs';
import * as path from 'path';
import logger from '../utils/logger.util';

/**
 * Firebase Service Account のインターフェース
 * 公式JSONファイルの構造に準拠
 */
export interface FirebaseServiceAccount {
  readonly type: string;
  readonly project_id: string;
  readonly private_key_id: string;
  readonly private_key: string;
  readonly client_email: string;
  readonly client_id: string;
  readonly auth_uri: string;
  readonly token_uri: string;
  readonly auth_provider_x509_cert_url: string;
  readonly client_x509_cert_url: string;
  readonly universe_domain?: string;
}

/**
 * Firebase Service Account 設定クラス
 * シングルトンパターンで設定を管理
 */
export class FirebaseServiceAccountConfig {
  private static instance: FirebaseServiceAccountConfig | null = null;
  private serviceAccount: FirebaseServiceAccount | null = null;
  private configFilePath: string = '';

  private constructor() {}

  /**
   * シングルトンインスタンスを取得
   */
  public static getInstance(): FirebaseServiceAccountConfig {
    if (!FirebaseServiceAccountConfig.instance) {
      FirebaseServiceAccountConfig.instance = new FirebaseServiceAccountConfig();
    }
    return FirebaseServiceAccountConfig.instance;
  }

  /**
   * 設定ファイルのパスを取得（.envから）
   */
  private getConfigFilePath(): string {
    const envPath = process.env.FIREBASE_SERVICE_ACCOUNT_KEY_PATH;

    if (!envPath) {
      throw new Error(
        'FIREBASE_SERVICE_ACCOUNT_KEY_PATH is not set in environment variables. ' +
        'Please set the path to your Firebase service account JSON file.'
      );
    }

    // 相対パスの場合はプロジェクトルートからの相対パスとして解決
    if (!path.isAbsolute(envPath)) {
      return path.resolve(process.cwd(), envPath);
    }

    return envPath;
  }

  /**
   * 必須フィールドの検証
   */
  private validateServiceAccount(data: unknown): data is FirebaseServiceAccount {
    if (!data || typeof data !== 'object') {
      return false;
    }

    const obj = data as Record<string, unknown>;
    const requiredFields = [
      'type',
      'project_id',
      'private_key',
      'client_email',
    ];

    for (const field of requiredFields) {
      if (!obj[field] || typeof obj[field] !== 'string') {
        logger.error(`Firebase service account missing required field: ${field}`);
        return false;
      }
    }

    if (obj.type !== 'service_account') {
      logger.error('Firebase service account type must be "service_account"');
      return false;
    }

    const privateKey = obj.private_key as string;
    if (!privateKey.includes('BEGIN PRIVATE KEY') || !privateKey.includes('END PRIVATE KEY')) {
      logger.error('Firebase service account private_key format is invalid');
      return false;
    }

    return true;
  }

  /**
   * Service Account 設定を読み込み
   */
  public load(): FirebaseServiceAccount {
    if (this.serviceAccount) {
      return this.serviceAccount;
    }

    try {
      this.configFilePath = this.getConfigFilePath();

      if (!fs.existsSync(this.configFilePath)) {
        throw new Error(
          `Firebase service account file not found: ${this.configFilePath}`
        );
      }

      const fileContent = fs.readFileSync(this.configFilePath, 'utf-8');
      const parsedData = JSON.parse(fileContent);

      if (!this.validateServiceAccount(parsedData)) {
        throw new Error('Invalid Firebase service account configuration');
      }

      this.serviceAccount = parsedData;

      logger.info('✓ Firebase service account configuration loaded', {
        projectId: this.serviceAccount.project_id,
        clientEmail: this.serviceAccount.client_email,
        configFile: this.configFilePath,
      });

      return this.serviceAccount;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to load Firebase service account configuration', {
        error: errorMessage,
        configPath: this.configFilePath || 'not set',
      });
      throw error;
    }
  }

  /**
   * プロジェクトIDを取得
   */
  public getProjectId(): string {
    return this.load().project_id;
  }

  /**
   * クライアントメールを取得
   */
  public getClientEmail(): string {
    return this.load().client_email;
  }

  /**
   * Service Account 全体を取得（firebase-admin.credential.cert() 用）
   */
  public getServiceAccount(): FirebaseServiceAccount {
    return this.load();
  }

  /**
   * 設定ファイルのパスを取得
   */
  public getLoadedConfigPath(): string {
    return this.configFilePath;
  }

  /**
   * テスト用: インスタンスをリセット
   */
  public static resetInstance(): void {
    FirebaseServiceAccountConfig.instance = null;
  }
}

export default FirebaseServiceAccountConfig;

