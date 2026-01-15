/**
 * 登録ページ
 * 新規ユーザー登録フォーム
 */
import { useState, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { authApi } from '../api/client';
import { useAuthStore } from '../store/authStore';
import { LANGUAGE_DISPLAY_NAMES, SUPPORTED_LANGUAGES, type UILanguage } from '../i18n';
import type { SupportedLanguage } from '../types';

export function RegisterPage() {
  const { t, i18n } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [nativeLanguage, setNativeLanguage] = useState<SupportedLanguage>('ja');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);

  /** 登録処理 */
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await authApi.register(
        email,
        password,
        displayName,
        nativeLanguage
      );
      setAuth(res.access_token, res.user);
      navigate('/menu');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.registerFailed'));
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
        <p className="subtitle">{t('auth.register')}</p>

        {error && <div className="error">{error}</div>}

        <div className="form-group">
          <label htmlFor="reg-email">{t('auth.email')}</label>
          <input
            id="reg-email"
            type="email"
            placeholder="your@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="reg-password">{t('auth.password')}</label>
          <input
            id="reg-password"
            type="password"
            placeholder={t('auth.passwordHint')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
        </div>

        <div className="form-group">
          <label htmlFor="reg-displayName">{t('auth.displayName')}</label>
          <input
            id="reg-displayName"
            type="text"
            placeholder={t('auth.displayNameHint')}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="reg-nativeLanguage">{t('auth.nativeLanguage')}</label>
          <select
            id="reg-nativeLanguage"
            value={nativeLanguage}
            onChange={(e) =>
              setNativeLanguage(e.target.value as SupportedLanguage)
            }
          >
            {SUPPORTED_LANGUAGES.map((lang) => (
              <option key={lang} value={lang}>
                {t(`language.${lang}`)}
              </option>
            ))}
          </select>
        </div>

        <button type="submit" disabled={loading}>
          {loading ? t('auth.registering') : t('auth.registerButton')}
        </button>
      </form>

      <p>
        {t('auth.hasAccount')} <Link to="/login">{t('auth.login')}</Link>
      </p>
    </div>
  );
}
