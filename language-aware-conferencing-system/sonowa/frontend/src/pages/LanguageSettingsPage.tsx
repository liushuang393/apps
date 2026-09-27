/**
 * 言語設定ページ
 * システム対応言語を設定する管理者向けページ
 * 最大4言語まで選択可能
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  adminApi,
  type LanguageOption,
  type LanguageSettings,
} from '../api/client';
import { LoadError } from '../components/LoadError';
import { languageName } from '../constants/languageNames';
import { useAuthStore } from '../store/authStore';
import '../styles/pages/language-settings.css';

/** 最大選択可能言語数 */
const MAX_LANGUAGES = 4;

/** 精度ティアの説明 */
const TIER_LABELS: Record<number, string> = {
  1: '★★★ (95%+)',
  2: '★★☆ (85-94%)',
  3: '★☆☆ (75-84%)',
};

export function LanguageSettingsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [settings, setSettings] = useState<LanguageSettings | null>(null);
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // 管理者でない場合はリダイレクト
  useEffect(() => {
    if (user && user.role !== 'admin') {
      navigate('/menu');
    }
  }, [user, navigate]);

  /** 設定を取得する（失敗時は loadError を立て、再試行で再呼出しできる） */
  const loadSettings = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const data = await adminApi.getLanguageSettings();
      setSettings(data);
      setSelectedLanguages(data.enabledLanguages);
    } catch {
      setLoadError(t('languageSettings.loadError'));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  // 初期データ取得
  useEffect(() => {
    if (!user || user.role !== 'admin') {
      return;
    }
    void loadSettings();
  }, [user, loadSettings]);

  /** 言語選択/解除 */
  const handleToggleLanguage = useCallback((code: string) => {
    setSelectedLanguages((prev) => {
      if (prev.includes(code)) {
        // 最低1言語は必要
        if (prev.length <= 1) return prev;
        return prev.filter((c) => c !== code);
      }
      // 最大4言語まで
      if (prev.length >= MAX_LANGUAGES) return prev;
      return [...prev, code];
    });
    setSuccessMessage(null);
  }, []);

  /** 保存 */
  const handleSave = useCallback(async () => {
    setIsSaving(true);
    setError(null);
    setSuccessMessage(null);
    try {
      await adminApi.updateLanguageSettings(selectedLanguages);
      setSuccessMessage(t('languageSettings.saveSuccess'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('languageSettings.saveError'));
    } finally {
      setIsSaving(false);
    }
  }, [selectedLanguages, t]);

  // 取得失敗時は空の一覧で保存させない（選択 0 件のまま保存される事故を防ぐ）
  if (isLoading || !settings) {
    return (
      <div className="language-settings-page" data-testid="language-settings-page">
        {!isLoading && loadError ? (
          <LoadError
            message={loadError}
            onRetry={() => void loadSettings()}
            testIdPrefix="language-settings"
          />
        ) : (
          <div className="loading">{t('common.loading')}</div>
        )}
      </div>
    );
  }

  return (
    <div className="language-settings-page" data-testid="language-settings-page">
      <header className="page-header">
        <button className="btn-back" onClick={() => navigate('/admin')}>
          ← {t('common.back')}
        </button>
        <h1>🌐 {t('languageSettings.title')}</h1>
      </header>

      <main className="settings-content">
        <div className="settings-info">
          <p>{t('languageSettings.description')}</p>
          <p className="selection-count">
            {t('languageSettings.selectionCount', {
              current: selectedLanguages.length,
              max: MAX_LANGUAGES,
            })}
          </p>
        </div>

        {error && <div className="error-message">{error}</div>}
        {successMessage && <div className="success-message">{successMessage}</div>}

        <div className="language-grid">
          {settings.allAvailableLanguages.map((lang: LanguageOption) => {
            const isSelected = selectedLanguages.includes(lang.code);
            const isDisabled = !isSelected && selectedLanguages.length >= MAX_LANGUAGES;
            return (
              <button
                key={lang.code}
                className={`language-card ${isSelected ? 'selected' : ''} ${isDisabled ? 'disabled' : ''}`}
                onClick={() => handleToggleLanguage(lang.code)}
                disabled={isDisabled}
              >
                <div className="lang-name">{languageName(lang.code, i18n.language)}</div>
                <div className="lang-code">{lang.code.toUpperCase()}</div>
                <div className="lang-tier">{TIER_LABELS[lang.tier]}</div>
                <span className={`status-badge ${isSelected ? 'active' : 'inactive'}`}>
                  {isSelected ? t('glossary.enabled') : t('glossary.disabled')}
                </span>
              </button>
            );
          })}
        </div>

        <div className="actions">
          <button className="btn-primary" onClick={handleSave} disabled={isSaving}>
            {isSaving ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </main>
    </div>
  );
}

