import crypto from 'crypto';
import { developerRepository, DeveloperRepository } from '../repositories/DeveloperRepository';
import { logger } from '../utils/logger';

/**
 * コールバックイベント種別
 * 開発者に通知するイベントの種類（Stripe の複雑なイベント名ではなくシンプルな名前）
 */
export type CallbackEventType =
  | 'payment.completed'       // 決済完了
  | 'payment.failed'          // 決済失敗
  | 'subscription.created'    // サブスクリプション開始
  | 'subscription.renewed'    // サブスクリプション更新
  | 'subscription.canceled'   // サブスクリプション解約
  | 'subscription.expired'    // サブスクリプション期限切れ
  | 'refund.completed'        // 返金完了
  | 'dispute.created'         // チャージバック発生
  | 'dispute.resolved';       // チャージバック解決

/**
 * コールバックのペイロード
 * 開発者が受け取るシンプルなJSON
 */
export interface CallbackPayload {
  /** イベントID（冪等性用） */
  event_id: string;
  /** イベント種別 */
  event_type: CallbackEventType;
  /** 発生日時（ISO 8601） */
  timestamp: string;
  /** 商品情報 */
  product?: {
    id: string;
    name: string;
    type: 'one_time' | 'subscription';
  };
  /** 顧客情報 */
  customer?: {
    email: string;
    name?: string;
  };
  /** 金額情報 */
  amount?: {
    value: number;
    currency: string;
    formatted: string;
  };
  /** 追加メタデータ */
  metadata?: Record<string, string>;
}

/**
 * コールバックリクエストのヘッダー
 */
interface CallbackHeaders {
  'Content-Type': string;
  'X-ForgePay-Event': string;
  'X-ForgePay-Timestamp': string;
  'X-ForgePay-Signature'?: string;
  'User-Agent': string;
}

/**
 * CallbackService - 開発者へのシンプルな決済通知
 * 
 * 開発者が Stripe webhook を直接処理しなくて済むように、
 * ForgePay が Stripe イベントを解析し、シンプルな JSON で通知する。
 * 
 * 特徴:
 * - シンプルな JSON ペイロード（Stripe の複雑なイベント形式ではない）
 * - HMAC-SHA256 署名で検証可能
 * - リトライ機能（最大3回、指数バックオフ）
 * - 設定不要で動作（callback_url が設定されている場合のみ送信）
 */
export class CallbackService {
  private developerRepo: DeveloperRepository;
  /** リトライ間隔（ミリ秒）: 10秒、30秒、90秒 */
  private retryIntervals = [10_000, 30_000, 90_000];

  constructor(developerRepo: DeveloperRepository = developerRepository) {
    this.developerRepo = developerRepo;
  }

  /**
   * 開発者にコールバック通知を送信
   * 
   * @param developerId - 開発者ID
   * @param payload - 通知ペイロード
   */
  async send(developerId: string, payload: CallbackPayload): Promise<void> {
    const developer = await this.developerRepo.findById(developerId);
    if (!developer?.callbackUrl) {
      // コールバックURL未設定の場合はスキップ
      return;
    }

    const headers = this.buildHeaders(payload, developer.callbackSecret);

    // 非同期でリトライ付き送信（メインフローをブロックしない）
    this.sendWithRetry(developer.callbackUrl, payload, headers, 0).catch((error) => {
      logger.error('コールバック送信失敗（全リトライ失敗）', {
        developerId,
        callbackUrl: developer.callbackUrl,
        eventType: payload.event_type,
        eventId: payload.event_id,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  /**
   * HMAC-SHA256 署名を生成
   */
  generateSignature(payload: string, secret: string): string {
    return crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');
  }

  /**
   * コールバックヘッダーを構築
   */
  private buildHeaders(payload: CallbackPayload, secret: string | null): CallbackHeaders {
    const timestamp = new Date().toISOString();
    const headers: CallbackHeaders = {
      'Content-Type': 'application/json',
      'X-ForgePay-Event': payload.event_type,
      'X-ForgePay-Timestamp': timestamp,
      'User-Agent': 'ForgePay-Webhook/1.0',
    };

    // 署名シークレットが設定されている場合は署名を付与
    if (secret) {
      const body = JSON.stringify(payload);
      const signaturePayload = `${timestamp}.${body}`;
      headers['X-ForgePay-Signature'] = `sha256=${this.generateSignature(signaturePayload, secret)}`;
    }

    return headers;
  }

  /**
   * リトライ付き送信
   */
  private async sendWithRetry(
    url: string,
    payload: CallbackPayload,
    headers: CallbackHeaders,
    attempt: number
  ): Promise<void> {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: headers as unknown as Record<string, string>,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000), // 10秒タイムアウト
      });

      if (response.ok) {
        logger.info('コールバック送信成功', {
          url,
          eventType: payload.event_type,
          statusCode: response.status,
          attempt: attempt + 1,
        });
        return;
      }

      // 4xx はリトライしない（設定ミスの可能性）
      if (response.status >= 400 && response.status < 500) {
        logger.warn('コールバック送信失敗（クライアントエラー、リトライなし）', {
          url,
          eventType: payload.event_type,
          statusCode: response.status,
        });
        return;
      }

      throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      if (attempt < this.retryIntervals.length) {
        const delay = this.retryIntervals[attempt];
        logger.warn('コールバック送信リトライ', {
          url,
          eventType: payload.event_type,
          attempt: attempt + 1,
          nextRetryMs: delay,
          error: error instanceof Error ? error.message : String(error),
        });

        await new Promise(resolve => setTimeout(resolve, delay));
        return this.sendWithRetry(url, payload, headers, attempt + 1);
      }

      throw error;
    }
  }
}

// シングルトンインスタンス
export const callbackService = new CallbackService();
