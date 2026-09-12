/**
 * プロフィール設定ページ
 * 表示名・母語を自己更新する（パスワードは既存リセット導線）
 */
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { adminApi, authApi, ApiError } from '../api/client';
import { useAuthStore } from '../store/authStore';
import { LANGUAGE_NAMES } from '../constants/languages';
import type { SupportedLanguage } from '../types';
import '../styles/pages/auth.css';
import '../styles/pages/profile.css';

export function ProfilePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, setAuth, logout } = useAuthStore();
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [nativeLanguage, setNativeLanguage] = useState<string>(
    user?.nativeLanguage ?? 'ja'
  );
  const [enabledLanguages, setEnabledLanguages] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const settings = await adminApi.getLanguageSettings();
        const langs = settings.enabledLanguages;
        setEnabledLanguages(langs);
        if (user?.nativeLanguage && !langs.includes(user.nativeLanguage)) {
          setEnabledLanguages([...langs, user.nativeLanguage]);
        }
      } catch {
        setEnabledLanguages(['ja', 'en', 'zh', 'vi']);
      }
    };
    void load();
  }, [user?.nativeLanguage]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);
    if (!displayName.trim()) {
      setError(t('profile.saveFailed'));
      setLoading(false);
      return;
    }
    try {
      const res = await authApi.updateMe({
        displayName: displayName.trim(),
        nativeLanguage,
      });
      setAuth(res.access_token, res.user);
      setSuccess(t('profile.saveSuccess'));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        logout();
        navigate('/login');
        return;
      }
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError(t('profile.saveFailed'));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page profile-page" data-testid="profile-page">
      <button type="button" className="profile-back" onClick={() => navigate('/menu')}>
        ← {t('common.back')}
      </button>
      <form onSubmit={handleSubmit} data-testid="profile-form">
        <h1>👤 {t('profile.title')}</h1>
        <p className="subtitle">{t('profile.subtitle')}</p>

        {error && <div className="error" data-testid="profile-error">{error}</div>}
        {success && <div className="success" data-testid="profile-success">{success}</div>}

        <div className="form-group">
          <label htmlFor="profile-email">{t('auth.email')}</label>
          <input id="profile-email" type="email" value={user?.email ?? ''} disabled />
        </div>

        <div className="form-group">
          <label htmlFor="profile-role">{t('profile.role')}</label>
          <input
            id="profile-role"
            data-testid="profile-role"
            type="text"
            value={t(`role.${user?.role ?? 'user'}`)}
            disabled
          />
        </div>

        <div className="form-group">
          <label htmlFor="profile-displayName">{t('auth.displayName')}</label>
          <input
            id="profile-displayName"
            data-testid="profile-display-name"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
            maxLength={100}
          />
        </div>

        <div className="form-group">
          <label htmlFor="profile-nativeLanguage">{t('auth.nativeLanguage')}</label>
          <select
            id="profile-nativeLanguage"
            data-testid="profile-native-language"
            value={nativeLanguage}
            onChange={(e) => setNativeLanguage(e.target.value as SupportedLanguage)}
          >
            {enabledLanguages.map((lang) => (
              <option key={lang} value={lang}>
                {LANGUAGE_NAMES[lang as SupportedLanguage] || lang}
              </option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          data-testid="profile-save"
          disabled={loading || !displayName.trim()}
        >
          {loading ? t('common.saving') : t('common.save')}
        </button>
      </form>
    </div>
  );
}
