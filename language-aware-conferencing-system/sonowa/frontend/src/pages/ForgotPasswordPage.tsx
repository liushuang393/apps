/**
 * パスワード忘れページ
 * メールアドレスを入力してリセットトークンを発行
 */
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { authApi } from '../api/client';
import { LANGUAGE_DISPLAY_NAMES, SUPPORTED_LANGUAGES, type UILanguage } from '../i18n';
import '../styles/pages/auth.css';

export function ForgotPasswordPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  /** リセットリクエスト送信 */
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const data = await authApi.requestPasswordReset(email);
      if (data.reset_token) {
        // 本人がその場で再設定する: トークン入力済みの再設定画面へそのまま進む。
        navigate(`/reset-password?token=${encodeURIComponent(data.reset_token)}`);
        return;
      }
      // メールで届ける方式（password_reset_self_service=False）のときだけ案内を出す。
      setSuccess(true);
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
            <p>✅ {t('auth.resetRequested')}</p>
            <p className="token-hint" data-testid="reset-mail-sent">
              {t('auth.resetMailSent')}
            </p>
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

