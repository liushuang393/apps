/**
 * パスワードリセットページ
 * トークンと新しいパスワードを入力してリセット実行
 */
import { useState, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { authApi } from '../api/client';
import { LANGUAGE_DISPLAY_NAMES, SUPPORTED_LANGUAGES, type UILanguage } from '../i18n';

export function ResetPasswordPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [token, setToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  /** パスワードリセット実行 */
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    // パスワード一致チェック
    if (newPassword !== confirmPassword) {
      setError(t('auth.passwordMismatch'));
      return;
    }

    setLoading(true);

    try {
      await authApi.confirmPasswordReset(token, newPassword);
      setSuccess(true);
      // 3秒後にログインページへリダイレクト
      setTimeout(() => navigate('/login'), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed');
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
        <h1>🔐 {t('auth.resetPassword')}</h1>

        {error && <div className="error">{error}</div>}

        {success ? (
          <div className="success-message">
            <p>✅ {t('auth.resetSuccess')}</p>
            <p>{t('auth.backToLogin')}...</p>
          </div>
        ) : (
          <>
            <div className="form-group">
              <label htmlFor="reset-token">{t('auth.resetToken')}</label>
              <input
                id="reset-token"
                type="text"
                placeholder={t('auth.resetTokenHint')}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="new-password">{t('auth.newPassword')}</label>
              <input
                id="new-password"
                type="password"
                placeholder={t('auth.passwordHint')}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={8}
              />
            </div>

            <div className="form-group">
              <label htmlFor="confirm-password">{t('auth.confirmPassword')}</label>
              <input
                id="confirm-password"
                type="password"
                placeholder={t('auth.confirmPassword')}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={8}
              />
            </div>

            <button type="submit" disabled={loading}>
              {loading ? t('auth.resetting') : t('auth.resetButton')}
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

