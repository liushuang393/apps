import crypto from 'crypto';
import {
  DeveloperRepository,
  developerRepository,
  Developer,
  CreateDeveloperParams,
} from '../repositories/DeveloperRepository';
import {
  ProductRepository,
  productRepository,
} from '../repositories/ProductRepository';
import { logger } from '../utils/logger';
import { emailService } from './EmailService';

/**
 * API key with plain text (only returned once on creation)
 */
export interface ApiKeyResult {
  apiKey: string; // Plain text API key (only shown once)
  prefix: string; // First 8 characters for identification
}

/**
 * Registration result
 */
export interface RegistrationResult {
  developer: Developer;
  apiKey: ApiKeyResult;
}

/**
 * Onboarding status
 */
export interface OnboardingStatus {
  developerId: string;
  email: string;
  steps: {
    accountCreated: boolean;
    apiKeyGenerated: boolean;
    stripeConnected: boolean;
    firstProductCreated: boolean;
    legalTemplatesConfigured: boolean;
    webhookConfigured: boolean;
  };
  completedSteps: number;
  totalSteps: number;
  isComplete: boolean;
  nextStep: string | null;
}

/**
 * DeveloperService — 開発者登録・オンボーディング管理
 *
 * 薄いレイヤーとして以下のみを担当:
 * - 開発者アカウント作成・管理
 * - API キー発行・検証
 * - Stripe 接続設定
 * - オンボーディングステータス管理
 *
 * 削除済み（外部サービスに委譲）:
 * - 法的テンプレート → 外部法的テンプレートサービス
 * - メール送信 → 外部メールサービス（将来的に統合）
 */
export class DeveloperService {
  private developerRepo: DeveloperRepository;
  private productRepo: ProductRepository;
  private readonly API_KEY_PREFIX = 'fpb'; // ForgePay Bridge

  constructor(
    developerRepo: DeveloperRepository = developerRepository,
    productRepo: ProductRepository = productRepository
  ) {
    this.developerRepo = developerRepo;
    this.productRepo = productRepo;
  }

  /**
   * 開発者登録 + ウェルカムメール送信
   */
  async register(
    email: string,
    options?: { testMode?: boolean }
  ): Promise<RegistrationResult> {
    // メールアドレス重複チェック
    const existing = await this.developerRepo.findByEmail(email);
    if (existing) {
      throw new Error('Email already registered');
    }

    // API キー生成
    const apiKey = this.generateApiKey(options?.testMode ?? true);
    const apiKeyHash = await this.hashApiKey(apiKey.apiKey);

    const createParams: CreateDeveloperParams = {
      email,
      apiKeyHash,
      testMode: options?.testMode ?? true,
    };

    const developer = await this.developerRepo.create(createParams);

    // ウェルカムメール送信（失敗してもアプリは止まらない）
    const dashboardUrl = process.env.DASHBOARD_URL ?? 'http://localhost:3001';
    emailService.sendWelcomeEmail(email, apiKey.apiKey).catch((err) =>
      logger.warn('ウェルカムメール送信失敗（登録自体は成功）', { error: err })
    );
    emailService.sendStripeSetupGuideEmail(email, dashboardUrl).catch((err) =>
      logger.warn('Stripe セットアップガイドメール送信失敗', { error: err })
    );

    logger.info('開発者登録完了', {
      developerId: developer.id,
      testMode: developer.testMode,
    });

    return { developer, apiKey };
  }

  /**
   * API キー再発行（処理中の決済セッションを事前チェック）
   *
   * @returns { apiKey, hasPendingPayments } — hasPendingPayments=true の場合は注意が必要
   */
  async regenerateApiKey(developerId: string): Promise<ApiKeyResult & { hasPendingPayments: boolean }> {
    const developer = await this.developerRepo.findById(developerId);
    if (!developer) {
      throw new Error('Developer not found');
    }

    // 処理中の決済セッションが存在するか確認
    const hasPendingPayments = await this.hasPendingCheckoutSessions(developerId);
    if (hasPendingPayments) {
      logger.warn('API キー再発行: 処理中の決済セッションあり', { developerId });
    }

    const apiKey = this.generateApiKey(developer.testMode);
    const apiKeyHash = await this.hashApiKey(apiKey.apiKey);

    await this.developerRepo.update(developerId, { apiKeyHash });

    // 再発行通知メール（失敗してもアプリは止まらない）
    emailService.sendKeyRegeneratedEmail(developer.email, apiKey.apiKey, hasPendingPayments).catch((err) =>
      logger.warn('再発行通知メール送信失敗', { error: err })
    );

    logger.info('API キー再発行完了', { developerId, hasPendingPayments });

    return { ...apiKey, hasPendingPayments };
  }

  /**
   * メールアドレスで API キーを忘れた場合の再発行
   * 旧キーはハッシュ化されているため平文では取得不可 → 新しいキーを発行してメール送信
   */
  async forgotApiKey(email: string): Promise<{ sent: boolean }> {
    const developer = await this.developerRepo.findByEmail(email);

    // セキュリティ上、メールが存在しない場合も同じレスポンスを返す（ユーザー列挙防止）
    if (!developer) {
      logger.info('forgot-key: メールアドレス不明（セキュリティ上同レスポンス）', { email: '***' });
      return { sent: true };
    }

    // 処理中の決済セッションを確認
    const hasPendingPayments = await this.hasPendingCheckoutSessions(developer.id);

    // 新しい API キーを生成
    const apiKey = this.generateApiKey(developer.testMode);
    const apiKeyHash = await this.hashApiKey(apiKey.apiKey);
    await this.developerRepo.update(developer.id, { apiKeyHash });

    // メール送信
    emailService.sendForgotKeyEmail(email, apiKey.apiKey).catch((err) =>
      logger.warn('forgot-key メール送信失敗', { error: err })
    );

    if (hasPendingPayments) {
      logger.warn('forgot-key: 処理中の決済セッションあり — キー更新済み', { developerId: developer.id });
    }

    logger.info('forgot-key: 新しい API キーを発行してメール送信', { developerId: developer.id });
    return { sent: true };
  }

  /**
   * 処理中の決済セッションが存在するか確認
   * API キー変更前のセーフティチェックに使用
   */
  private async hasPendingCheckoutSessions(developerId: string): Promise<boolean> {
    try {
      const { pool } = await import('../config/database');
      const result = await pool.query(
        `SELECT COUNT(*) as count FROM checkout_sessions
         WHERE developer_id = $1 AND status = 'open'`,
        [developerId]
      );
      return parseInt(result.rows[0].count, 10) > 0;
    } catch {
      // DB エラーはセーフティチェックの失敗として扱わない（ブロックしない）
      return false;
    }
  }

  /**
   * Validate an API key
   */
  async validateApiKey(apiKey: string): Promise<Developer | null> {
    const apiKeyHash = await this.hashApiKey(apiKey);
    return this.developerRepo.findByApiKeyHash(apiKeyHash);
  }

  /**
   * Get developer by ID
   */
  async getDeveloper(id: string): Promise<Developer | null> {
    return this.developerRepo.findById(id);
  }

  /**
   * Get developer by email
   */
  async getDeveloperByEmail(email: string): Promise<Developer | null> {
    return this.developerRepo.findByEmail(email);
  }

  /**
   * Update developer settings
   * ノーコード決済リンク用のデフォルト設定を含む
   */
  async updateSettings(
    developerId: string,
    settings: {
      testMode?: boolean;
      webhookSecret?: string;
      defaultSuccessUrl?: string | null;
      defaultCancelUrl?: string | null;
      defaultLocale?: string;
      defaultCurrency?: string;
      defaultPaymentMethods?: string[];
      callbackUrl?: string | null;
      callbackSecret?: string | null;
      companyName?: string | null;
      stripeSecretKeyEnc?: string | null;
      stripePublishableKey?: string | null;
      stripeWebhookEndpointSecret?: string | null;
      stripeConfigured?: boolean;
    }
  ): Promise<Developer | null> {
    return this.developerRepo.update(developerId, settings);
  }

  /**
   * Connect Stripe account
   */
  async connectStripeAccount(
    developerId: string,
    stripeAccountId: string
  ): Promise<Developer | null> {
    const developer = await this.developerRepo.update(developerId, {
      stripeAccountId,
    });

    if (developer) {
      logger.info('Stripe account connected', {
        developerId,
        stripeAccountId,
      });
    }

    return developer;
  }

  /**
   * Get onboarding status for a developer
   */
  async getOnboardingStatus(developerId: string): Promise<OnboardingStatus | null> {
    const developer = await this.developerRepo.findById(developerId);
    if (!developer) {
      return null;
    }

    // オンボーディングステップの確認
    const products = await this.productRepo.findByDeveloperId(developer.id, true);
    const steps = {
      accountCreated: true,
      apiKeyGenerated: true,
      stripeConnected: !!developer.stripeAccountId || !!developer.stripeSecretKeyEnc,
      firstProductCreated: products.length > 0,
      legalTemplatesConfigured: true, // 外部サービスに委譲済みのためスキップ
      webhookConfigured: !!developer.webhookSecret || !!developer.callbackUrl,
    };

    const completedSteps = Object.values(steps).filter(Boolean).length;
    const totalSteps = Object.keys(steps).length;
    const isComplete = completedSteps === totalSteps;

    // 次のステップを決定
    let nextStep: string | null = null;
    if (!steps.stripeConnected) {
      nextStep = 'Stripe アカウントを接続してください';
    } else if (!steps.firstProductCreated) {
      nextStep = '最初の商品を作成してください';
    } else if (!steps.webhookConfigured) {
      nextStep = 'Webhook / コールバック URL を設定してください';
    }

    return {
      developerId,
      email: developer.email,
      steps,
      completedSteps,
      totalSteps,
      isComplete,
      nextStep,
    };
  }

  /**
   * Switch between test and live mode
   */
  async switchMode(developerId: string, testMode: boolean): Promise<Developer | null> {
    const developer = await this.developerRepo.update(developerId, { testMode });

    if (developer) {
      logger.info('Developer mode switched', {
        developerId,
        testMode,
      });
    }

    return developer;
  }

  /**
   * Delete developer account
   */
  async deleteAccount(developerId: string): Promise<boolean> {
    return this.developerRepo.delete(developerId);
  }

  /**
   * Generate API key
   */
  private generateApiKey(testMode: boolean): ApiKeyResult {
    const mode = testMode ? 'test' : 'live';
    const randomPart = crypto.randomBytes(24).toString('base64url');
    const apiKey = `${this.API_KEY_PREFIX}_${mode}_${randomPart}`;

    return {
      apiKey,
      prefix: apiKey.substring(0, 12),
    };
  }

  /**
   * Hash API key for storage
   * Note: Using a simple hash for faster lookups. For production,
   * consider using a slower hash like bcrypt with a cache layer.
   */
  private async hashApiKey(apiKey: string): Promise<string> {
    // Using SHA-256 for fast lookups
    return crypto.createHash('sha256').update(apiKey).digest('hex');
  }

}

// Export singleton instance
export const developerService = new DeveloperService();
