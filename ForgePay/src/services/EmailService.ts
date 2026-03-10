import { logger } from '../utils/logger';
import { config } from '../config';

/**
 * メール送信サービス
 *
 * 環境変数 EMAIL_SMTP_HOST が設定されている場合は nodemailer で SMTP 送信。
 * 未設定（開発環境）の場合はコンソールにログ出力するコンソールトランスポートを使用。
 *
 * 本番環境での利用:
 *   npm install nodemailer
 *   EMAIL_SMTP_HOST=smtp.example.com
 *   EMAIL_SMTP_PORT=587
 *   EMAIL_SMTP_USER=user@example.com
 *   EMAIL_SMTP_PASS=password
 *   EMAIL_FROM=noreply@forgepay.io
 */

export interface SendMailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface EmailService {
  sendMail(options: SendMailOptions): Promise<void>;
  sendWelcomeEmail(to: string, apiKey: string): Promise<void>;
  sendForgotKeyEmail(to: string, newApiKey: string): Promise<void>;
  sendKeyRegeneratedEmail(to: string, newApiKey: string, hasPendingPayments: boolean): Promise<void>;
  sendStripeSetupGuideEmail(to: string, dashboardUrl: string): Promise<void>;
}

/**
 * コンソールトランスポート（開発環境・デフォルト）
 * メール内容をログに出力する
 */
class ConsoleEmailTransport implements EmailService {
  async sendMail(options: SendMailOptions): Promise<void> {
    logger.info('📧 [EmailService - Console] メール送信（開発環境）', {
      to: options.to,
      subject: options.subject,
      preview: options.text?.substring(0, 200) ?? 'HTMLメール',
    });
    console.log('─'.repeat(60));
    console.log(`📧 To: ${options.to}`);
    console.log(`📧 Subject: ${options.subject}`);
    console.log(`📧 Body:\n${options.text ?? '(HTMLメール - テキスト版なし)'}`);
    console.log('─'.repeat(60));
  }

  async sendWelcomeEmail(to: string, apiKey: string): Promise<void> {
    await this.sendMail({
      to,
      subject: '【ForgePay】ご登録ありがとうございます — API キーをご確認ください',
      html: buildWelcomeHtml(apiKey),
      text: buildWelcomeText(apiKey),
    });
  }

  async sendForgotKeyEmail(to: string, newApiKey: string): Promise<void> {
    await this.sendMail({
      to,
      subject: '【ForgePay】API キーを再発行しました',
      html: buildForgotKeyHtml(newApiKey),
      text: buildForgotKeyText(newApiKey),
    });
  }

  async sendKeyRegeneratedEmail(to: string, newApiKey: string, hasPendingPayments: boolean): Promise<void> {
    await this.sendMail({
      to,
      subject: '【ForgePay】API キーが再発行されました',
      html: buildKeyRegeneratedHtml(newApiKey, hasPendingPayments),
      text: buildKeyRegeneratedText(newApiKey, hasPendingPayments),
    });
  }

  async sendStripeSetupGuideEmail(to: string, dashboardUrl: string): Promise<void> {
    await this.sendMail({
      to,
      subject: '【ForgePay】次のステップ: Stripe アカウントを接続してください',
      html: buildStripeSetupHtml(dashboardUrl),
      text: buildStripeSetupText(dashboardUrl),
    });
  }
}

/**
 * SMTP トランスポート（本番環境）
 * nodemailer を動的にロードする
 */
class SmtpEmailTransport extends ConsoleEmailTransport {
  private transporter: unknown = null;

  private async getTransporter() {
    if (this.transporter) return this.transporter;

    try {
      // nodemailer はオプション依存。npm install nodemailer で有効化
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const nodemailer = require('nodemailer');
      this.transporter = nodemailer.createTransport({
        host: config.email.smtpHost,
        port: config.email.smtpPort,
        secure: config.email.smtpSecure,
        auth:
          config.email.smtpUser && config.email.smtpPass
            ? { user: config.email.smtpUser, pass: config.email.smtpPass }
            : undefined,
      });
      return this.transporter;
    } catch {
      logger.warn('nodemailer が未インストール → コンソールモードにフォールバック (npm install nodemailer で SMTP 送信を有効化)');
      return null;
    }
  }

  async sendMail(options: SendMailOptions): Promise<void> {
    const transporter = await this.getTransporter() as any;
    if (!transporter) {
      // nodemailer が使えない場合はコンソールにフォールバック
      return super.sendMail(options);
    }

    try {
      await transporter.sendMail({
        from: config.email.from,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
      });
      logger.info('メール送信完了 (SMTP)', { to: options.to, subject: options.subject });
    } catch (error) {
      logger.error('SMTP メール送信失敗', { error, to: options.to });
      // 送信失敗はアプリを止めない（メールは補助的な機能）
    }
  }
}

// ============================================================
// メールテンプレート
// ============================================================

function buildWelcomeHtml(apiKey: string): string {
  return `
<!DOCTYPE html>
<html>
<body style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
  <h1 style="color: #4F46E5;">ForgePay へようこそ 🎉</h1>
  <p>ご登録ありがとうございます。以下の API キーでダッシュボードにログインできます。</p>

  <div style="background: #F5F3FF; border: 2px solid #4F46E5; border-radius: 8px; padding: 20px; margin: 20px 0;">
    <p style="margin: 0 0 8px; font-size: 12px; color: #6B7280; font-weight: 600; letter-spacing: 0.05em;">YOUR API KEY</p>
    <code style="font-size: 14px; word-break: break-all; color: #1E1B4B;">${apiKey}</code>
  </div>

  <div style="background: #FEF3C7; border-radius: 8px; padding: 12px 16px; margin: 16px 0;">
    <strong>⚠️ 重要:</strong> この API キーは<strong>一度しか表示されません</strong>。
    今すぐ安全な場所に保存してください。
  </div>

  <h2 style="color: #374151; font-size: 16px;">次のステップ</h2>
  <ol style="line-height: 1.8;">
    <li>ダッシュボードにログイン</li>
    <li>Settings → Stripe API Keys で Stripe アカウントを接続</li>
    <li>Products で最初の商品を作成</li>
    <li>API で決済フローを実装</li>
  </ol>

  <p style="color: #6B7280; font-size: 12px; margin-top: 30px; border-top: 1px solid #E5E7EB; padding-top: 16px;">
    ForgePay — OpenAI ChatGPT Apps 収益化プラットフォーム
  </p>
</body>
</html>`;
}

function buildWelcomeText(apiKey: string): string {
  return `ForgePay へようこそ！

API キー: ${apiKey}

⚠️ 重要: この API キーは一度しか表示されません。今すぐ保存してください。

次のステップ:
1. ダッシュボードにログイン
2. Settings → Stripe API Keys で Stripe アカウントを接続
3. Products で最初の商品を作成
4. API で決済フローを実装

---
ForgePay`;
}

function buildForgotKeyHtml(newApiKey: string): string {
  return `
<!DOCTYPE html>
<html>
<body style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
  <h1 style="color: #4F46E5;">API キーを再発行しました</h1>
  <p>API キー再発行のリクエストを受け付け、新しいキーを発行しました。</p>
  <p><strong>旧キーは即時無効になっています。</strong></p>

  <div style="background: #F5F3FF; border: 2px solid #4F46E5; border-radius: 8px; padding: 20px; margin: 20px 0;">
    <p style="margin: 0 0 8px; font-size: 12px; color: #6B7280; font-weight: 600; letter-spacing: 0.05em;">NEW API KEY</p>
    <code style="font-size: 14px; word-break: break-all; color: #1E1B4B;">${newApiKey}</code>
  </div>

  <div style="background: #FEF3C7; border-radius: 8px; padding: 12px 16px; margin: 16px 0;">
    <strong>⚠️ 重要:</strong> このキーも<strong>一度しか表示されません</strong>。
    今すぐ保存してください。
  </div>

  <div style="background: #FEE2E2; border-radius: 8px; padding: 12px 16px; margin: 16px 0;">
    <strong>🚨 このメールに心当たりがない場合:</strong>
    第三者が API キーの再発行を試みた可能性があります。
    直ちにサポートまでご連絡ください。
  </div>

  <p style="color: #6B7280; font-size: 12px; margin-top: 30px; border-top: 1px solid #E5E7EB; padding-top: 16px;">
    ForgePay — OpenAI ChatGPT Apps 収益化プラットフォーム
  </p>
</body>
</html>`;
}

function buildForgotKeyText(newApiKey: string): string {
  return `API キーを再発行しました

新しい API キー: ${newApiKey}

⚠️ 旧キーは即時無効です。新しいキーを今すぐ保存してください。

このメールに心当たりがない場合は直ちにサポートへご連絡ください。

---
ForgePay`;
}

function buildKeyRegeneratedHtml(newApiKey: string, hasPendingPayments: boolean): string {
  const pendingWarning = hasPendingPayments ? `
  <div style="background: #FEF3C7; border-radius: 8px; padding: 12px 16px; margin: 16px 0;">
    <strong>⚠️ 注意:</strong> キー再発行時に<strong>処理中の決済セッションが存在していました</strong>。
    それらのセッションは正常に完了しますが、<br>完了後の Webhook 通知には新しいキーが必要です。
  </div>` : '';

  return `
<!DOCTYPE html>
<html>
<body style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
  <h1 style="color: #4F46E5;">API キーが再発行されました</h1>
  <p>API キーが正常に再発行されました。新しいキーは以下の通りです。</p>

  <div style="background: #F5F3FF; border: 2px solid #4F46E5; border-radius: 8px; padding: 20px; margin: 20px 0;">
    <p style="margin: 0 0 8px; font-size: 12px; color: #6B7280; font-weight: 600; letter-spacing: 0.05em;">NEW API KEY</p>
    <code style="font-size: 14px; word-break: break-all; color: #1E1B4B;">${newApiKey}</code>
  </div>

  ${pendingWarning}

  <div style="background: #FEE2E2; border-radius: 8px; padding: 12px 16px; margin: 16px 0;">
    <strong>🚨 このメールに心当たりがない場合:</strong>
    第三者があなたの API キーを再発行した可能性があります。
    直ちにサポートまでご連絡ください。
  </div>

  <p style="color: #6B7280; font-size: 12px; margin-top: 30px; border-top: 1px solid #E5E7EB; padding-top: 16px;">
    ForgePay — OpenAI ChatGPT Apps 収益化プラットフォーム
  </p>
</body>
</html>`;
}

function buildKeyRegeneratedText(newApiKey: string, hasPendingPayments: boolean): string {
  const pendingNote = hasPendingPayments
    ? '\n⚠️ 注意: 再発行時に処理中の決済セッションが存在しました。それらは正常完了しますが、アプリのキー設定を更新してください。\n'
    : '';
  return `API キーが再発行されました

新しい API キー: ${newApiKey}
${pendingNote}
旧キーは即時無効です。アプリの API キー設定を更新してください。

このメールに心当たりがない場合は直ちにサポートへご連絡ください。

---
ForgePay`;
}

function buildStripeSetupHtml(dashboardUrl: string): string {
  return `
<!DOCTYPE html>
<html>
<body style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
  <h1 style="color: #4F46E5;">Stripe アカウントを接続しましょう</h1>
  <p>ForgePay の登録が完了しました。決済を受け取るには <strong>Stripe アカウントの接続</strong> が必要です。</p>

  <h2 style="font-size: 16px; color: #374151;">手順（3ステップ）</h2>

  <div style="background: #F9FAFB; border-radius: 8px; padding: 16px; margin: 12px 0;">
    <strong>Step 1: Stripe にサインアップ / ログイン</strong><br>
    <a href="https://dashboard.stripe.com/register" style="color: #4F46E5;">https://dashboard.stripe.com/register</a>
  </div>

  <div style="background: #F9FAFB; border-radius: 8px; padding: 16px; margin: 12px 0;">
    <strong>Step 2: API キーを取得</strong><br>
    Stripe Dashboard → Developers → API keys<br>
    <a href="https://dashboard.stripe.com/test/apikeys" style="color: #4F46E5;">https://dashboard.stripe.com/test/apikeys</a><br>
    <br>
    取得するキー:<br>
    • <strong>Secret key</strong> (sk_test_... または sk_live_...)<br>
    • <strong>Publishable key</strong> (pk_test_... または pk_live_...)
  </div>

  <div style="background: #F9FAFB; border-radius: 8px; padding: 16px; margin: 12px 0;">
    <strong>Step 3: ForgePay ダッシュボードで設定</strong><br>
    以下のリンクから Settings → Stripe API Keys に貼り付けてください:<br>
    <a href="${dashboardUrl}/settings" style="color: #4F46E5;">${dashboardUrl}/settings</a>
  </div>

  <div style="background: #ECFDF5; border-radius: 8px; padding: 12px 16px; margin: 16px 0;">
    <strong>💡 Webhook Secret（オプション）</strong><br>
    決済完了の通知を受け取るには Stripe CLI でローカル転送するか、
    Stripe Dashboard で Webhook エンドポイントを登録してください。
  </div>

  <p style="color: #6B7280; font-size: 12px; margin-top: 30px; border-top: 1px solid #E5E7EB; padding-top: 16px;">
    ForgePay — OpenAI ChatGPT Apps 収益化プラットフォーム
  </p>
</body>
</html>`;
}

function buildStripeSetupText(dashboardUrl: string): string {
  return `Stripe アカウントを接続しましょう

Step 1: Stripe にサインアップ
https://dashboard.stripe.com/register

Step 2: API キーを取得
Stripe Dashboard → Developers → API keys
https://dashboard.stripe.com/test/apikeys
取得するキー: Secret key (sk_test_...) と Publishable key (pk_test_...)

Step 3: ForgePay ダッシュボードで設定
${dashboardUrl}/settings → Stripe API Keys

---
ForgePay`;
}

// ============================================================
// シングルトン（環境変数で自動切替）
// ============================================================

function createEmailService(): EmailService {
  if (config.email.smtpHost) {
    logger.info('EmailService: SMTP モードで初期化', { host: config.email.smtpHost });
    return new SmtpEmailTransport();
  }
  logger.info('EmailService: コンソールモードで初期化 (EMAIL_SMTP_HOST 未設定)');
  return new ConsoleEmailTransport();
}

export const emailService = createEmailService();
