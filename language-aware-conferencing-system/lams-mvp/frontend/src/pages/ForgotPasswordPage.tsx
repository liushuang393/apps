/**
 * パスワード忘れページ
 * メールアドレスを入力してリセットトークンを発行
 */
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { authApi } from '../api/client';
import { LANGUAGE_DISPLAY_NAMES, SUPPORTED_LANGUAGES, type UILanguage } from '../i18n';

export function ForgotPasswordPage() {
  const { t, i18n } = useTranslation();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [resetToken, setResetToken] = useState('');

  /** リセットリクエスト送信 */
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const data = await authApi.requestPasswordReset(email);
      setSuccess(true);
      // MVP版：トークンを表示
      if (data.reset_token) {
        setResetToken(data.reset_token);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      {/* 言語切替 */}
      <div className="auth-language-selector">
        <select
          value={i18n.language}
          onChange={(e) => i18n.changeLanguage(e.target.value as UILanguage)}
        >
          {SUPPORTED_LANGUAGES.map((lang) => (
            <option key={lang} value={lang}>
              {LANGUAGE_DISPLAY_NAMES[lang]}
            </option>
          ))}
        </select>
      </div>

      <form onSubmit={handleSubmit}>
        <h1>🔑 {t('auth.resetPassword')}</h1>
        <p className="subtitle">{t('auth.resetPasswordDesc')}</p>

        {error && <div className="error">{error}</div>}

        {success ? (
          <div className="success-message">
            <p>✅ {t('auth.resetSuccess')}</p>
            {resetToken && (
              <div className="token-display">
                <p><strong>MVP版リセットトークン:</strong></p>
                <code className="reset-token">{resetToken}</code>
                <p className="token-hint">
                  ※ 本番環境ではメールで送信されます
                </p>
              </div>
            )}
            <Link to="/reset-password" className="btn-link">
              {t('auth.resetPassword')}へ進む
            </Link>
          </div>
        ) : (
          <>
            <div className="form-group">
              <label htmlFor="forgot-email">{t('auth.email')}</label>
              <input
                id="forgot-email"
                type="email"
                placeholder="your@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <button type="submit" disabled={loading}>
              {loading ? t('auth.sending') : t('auth.sendResetLink')}
            </button>
          </>
        )}
      </form>

      <p>
        <Link to="/login">{t('auth.backToLogin')}</Link>
      </p>
    </div>
  );
}

