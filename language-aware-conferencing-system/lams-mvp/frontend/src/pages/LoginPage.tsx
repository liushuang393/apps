/**
 * ログインページ
 * ユーザー認証のためのログインフォーム
 */
import { useState, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { authApi } from '../api/client';
import { useAuthStore } from '../store/authStore';
import { LANGUAGE_DISPLAY_NAMES, SUPPORTED_LANGUAGES, type UILanguage } from '../i18n';

export function LoginPage() {
  const { t, i18n } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);

  /** ログイン処理 */
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await authApi.login(email, password);
      setAuth(res.access_token, res.user);
      navigate('/menu');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.loginFailed'));
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
        <h1>🌐 {t('app.title')}</h1>
        <p className="subtitle">{t('app.subtitle')}</p>

        {error && <div className="error">{error}</div>}

        <div className="form-group">
          <label htmlFor="login-email">{t('auth.email')}</label>
          <input
            id="login-email"
            type="email"
            placeholder="your@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="login-password">{t('auth.password')}</label>
          <input
            id="login-password"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        <button type="submit" disabled={loading}>
          {loading ? t('auth.loggingIn') : t('auth.loginButton')}
        </button>

        <p className="forgot-password-link">
          <Link to="/forgot-password">{t('auth.forgotPassword')}</Link>
        </p>
      </form>

      <p>
        {t('auth.noAccount')} <Link to="/register">{t('auth.register')}</Link>
      </p>
    </div>
  );
}
