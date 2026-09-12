/**
 * AI パイプライン設定ページ
 * 方式1（Realtime S2S）と方式2（品質カスケード）のプリセット切替。
 * ローカル GPU は上級スロットのみ（方式ではない）。
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  adminApi,
  type PipelineSettingsFields,
  type PipelineSettingsResponse,
} from '../api/client';
import { useAuthStore } from '../store/authStore';
import '../styles/pages/language-settings.css';
import '../styles/pages/ai-pipeline-settings.css';

interface FormState {
  aiProvider: string;
  asrProvider: string;
  mtProvider: string;
  ttsProvider: string;
  defaultMode: string;
  enablePartialSubtitles: boolean;
  llmCorrectionEnabled: boolean;
}

/** 画面上の2方式（保存スキーマは既存スロット + 品質フラグへ写像） */
type PipelinePreset = 'realtime_s2s' | 'quality_cascade';

const PRESET_VALUES: Record<PipelinePreset, FormState> = {
  realtime_s2s: {
    aiProvider: 'gpt_realtime',
    asrProvider: 'auto',
    mtProvider: 'auto',
    ttsProvider: 'auto',
    defaultMode: 'a',
    enablePartialSubtitles: false,
    llmCorrectionEnabled: false,
  },
  quality_cascade: {
    aiProvider: 'gpt4o_transcribe',
    asrProvider: 'auto',
    mtProvider: 'auto',
    ttsProvider: 'auto',
    defaultMode: 'hybrid',
    enablePartialSubtitles: true,
    llmCorrectionEnabled: true,
  },
};

function toForm(fields: PipelineSettingsFields): FormState {
  return {
    aiProvider: fields.aiProvider,
    asrProvider: fields.asrProvider,
    mtProvider: fields.mtProvider,
    ttsProvider: fields.ttsProvider,
    defaultMode: fields.defaultMode,
    enablePartialSubtitles: fields.enablePartialSubtitles,
    llmCorrectionEnabled: fields.llmCorrectionEnabled,
  };
}

function detectPreset(form: FormState): PipelinePreset | 'custom' {
  const entries = Object.entries(PRESET_VALUES) as [PipelinePreset, FormState][];
  for (const [key, value] of entries) {
    if (
      form.aiProvider === value.aiProvider &&
      form.asrProvider === value.asrProvider &&
      form.mtProvider === value.mtProvider &&
      form.ttsProvider === value.ttsProvider &&
      form.defaultMode === value.defaultMode &&
      form.enablePartialSubtitles === value.enablePartialSubtitles &&
      form.llmCorrectionEnabled === value.llmCorrectionEnabled
    ) {
      return key;
    }
  }
  return 'custom';
}

/** 方式1（S2S）では ASR/MT/TTS スロットを auto に正規化する。 */
function normalizeForSave(form: FormState): FormState {
  const isS2s =
    form.aiProvider === 'gpt_realtime' || form.aiProvider === 'gemini_live';
  if (!isS2s) {
    return form;
  }
  return {
    ...form,
    asrProvider: 'auto',
    mtProvider: 'auto',
    ttsProvider: 'auto',
  };
}

export function AiPipelineSettingsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [settings, setSettings] = useState<PipelineSettingsResponse | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    if (user && user.role !== 'admin') {
      navigate('/menu');
    }
  }, [user, navigate]);

  useEffect(() => {
    if (!user || user.role !== 'admin') {
      return;
    }
    const fetchSettings = async () => {
      try {
        const data = await adminApi.getAiPipelineSettings();
        setSettings(data);
        setForm(toForm(data.effective));
      } catch (err) {
        setError(err instanceof Error ? err.message : t('aiPipelineSettings.loadError'));
      } finally {
        setIsLoading(false);
      }
    };
    void fetchSettings();
  }, [user, t]);

  const handleChange = useCallback((key: keyof FormState, value: string | boolean) => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
    setSuccessMessage(null);
  }, []);

  const handlePreset = useCallback((preset: PipelinePreset) => {
    setForm(PRESET_VALUES[preset]);
    setSuccessMessage(null);
  }, []);

  const handleSave = useCallback(async () => {
    if (!form) {
      return;
    }
    setIsSaving(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const payload = normalizeForSave(form);
      const data = await adminApi.updateAiPipelineSettings({
        aiProvider: payload.aiProvider,
        asrProvider: payload.asrProvider,
        mtProvider: payload.mtProvider,
        ttsProvider: payload.ttsProvider,
        defaultMode: payload.defaultMode,
        enablePartialSubtitles: payload.enablePartialSubtitles,
        llmCorrectionEnabled: payload.llmCorrectionEnabled,
      });
      setSettings(data);
      setForm(toForm(data.effective));
      setSuccessMessage(t('aiPipelineSettings.saveSuccess'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('aiPipelineSettings.saveError'));
    } finally {
      setIsSaving(false);
    }
  }, [form, t]);

  if (isLoading || !form || !settings) {
    return (
      <div
        className="language-settings-page ai-pipeline-settings-page"
        data-testid="ai-pipeline-page"
      >
        <div className="loading">{t('common.loading')}</div>
      </div>
    );
  }

  const { options, envDefaults, warnings, revision } = settings;
  const activePreset = detectPreset(form);
  const isS2sPreset =
    form.aiProvider === 'gpt_realtime' || form.aiProvider === 'gemini_live';

  return (
    <div
      className="language-settings-page ai-pipeline-settings-page"
      data-testid="ai-pipeline-page"
    >
      {/* E2E: ai-pipeline-page / ai-pipeline-save（mock は E2E Aレーン用） */}
      <header className="page-header">
        <button type="button" className="btn-back" onClick={() => navigate('/admin')}>
          ← {t('common.back')}
        </button>
        <h1>{t('aiPipelineSettings.title')}</h1>
      </header>

      <main className="settings-content">
        <div className="settings-info">
          <p>{t('aiPipelineSettings.description')}</p>
          <p className="selection-count">
            {t('aiPipelineSettings.revision', { revision })}
          </p>
        </div>

        {error && <div className="error-message">{error}</div>}
        {successMessage && <div className="success-message">{successMessage}</div>}
        {warnings.length > 0 && (
          <div className="warning-message">
            <p>{t('aiPipelineSettings.warningsTitle')}</p>
            <ul>
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        <section className="pipeline-presets" aria-label={t('aiPipelineSettings.presetsTitle')}>
          <h2>{t('aiPipelineSettings.presetsTitle')}</h2>
          <p className="hint-text">{t('aiPipelineSettings.presetsHint')}</p>
          <div className="preset-buttons">
            {(Object.keys(PRESET_VALUES) as PipelinePreset[]).map((preset) => (
              <button
                key={preset}
                type="button"
                className={`preset-button ${activePreset === preset ? 'active' : ''}`}
                onClick={() => handlePreset(preset)}
              >
                <strong>{t(`aiPipelineSettings.preset.${preset}.label`)}</strong>
                <span>{t(`aiPipelineSettings.preset.${preset}.desc`)}</span>
              </button>
            ))}
          </div>
          {activePreset === 'custom' && (
            <p className="hint-text">{t('aiPipelineSettings.customPreset')}</p>
          )}
          {isS2sPreset && (
            <p className="hint-text">{t('aiPipelineSettings.s2sSlotIgnored')}</p>
          )}
          {activePreset === 'quality_cascade' && (
            <p className="hint-text">{t('aiPipelineSettings.qualityPackHint')}</p>
          )}
        </section>

        <section className="pipeline-form">
          <label className="pipeline-field">
            <span>{t('aiPipelineSettings.defaultMode')}</span>
            <select
              value={form.defaultMode}
              onChange={(e) => handleChange('defaultMode', e.target.value)}
            >
              {options.defaultMode.map((v) => (
                <option key={v} value={v}>
                  {t(`aiPipelineSettings.mode.${v}`)}
                </option>
              ))}
            </select>
            <small>
              {t('aiPipelineSettings.envDefault')}: {envDefaults.defaultMode}
            </small>
          </label>

          <label className="pipeline-field pipeline-checkbox">
            <input
              type="checkbox"
              checked={form.enablePartialSubtitles}
              onChange={(e) => handleChange('enablePartialSubtitles', e.target.checked)}
            />
            <span>{t('aiPipelineSettings.enablePartialSubtitles')}</span>
          </label>

          <label className="pipeline-field pipeline-checkbox">
            <input
              type="checkbox"
              checked={form.llmCorrectionEnabled}
              onChange={(e) => handleChange('llmCorrectionEnabled', e.target.checked)}
            />
            <span>{t('aiPipelineSettings.llmCorrectionEnabled')}</span>
          </label>

          <button
            type="button"
            className="btn-secondary"
            onClick={() => setShowAdvanced((v) => !v)}
          >
            {showAdvanced
              ? t('aiPipelineSettings.hideAdvanced')
              : t('aiPipelineSettings.showAdvanced')}
          </button>

          {showAdvanced && (
            <>
              <p className="hint-text">{t('aiPipelineSettings.advancedLocalHint')}</p>
              <label className="pipeline-field">
                <span>{t('aiPipelineSettings.aiProvider')}</span>
                <select
                  value={form.aiProvider}
                  onChange={(e) => handleChange('aiProvider', e.target.value)}
                >
                  {options.aiProvider.map((v) => (
                    <option key={v} value={v}>
                      {v === 'mock' ? 'mock（E2E Aレーン専用）' : v}
                    </option>
                  ))}
                </select>
                <small>
                  {t('aiPipelineSettings.envDefault')}: {envDefaults.aiProvider}
                </small>
              </label>

              <label className="pipeline-field">
                <span>{t('aiPipelineSettings.asrProvider')}</span>
                <select
                  value={form.asrProvider}
                  onChange={(e) => handleChange('asrProvider', e.target.value)}
                  disabled={isS2sPreset}
                >
                  {options.asrProvider.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
                <small>
                  {t('aiPipelineSettings.envDefault')}: {envDefaults.asrProvider}
                </small>
              </label>

              <label className="pipeline-field">
                <span>{t('aiPipelineSettings.mtProvider')}</span>
                <select
                  value={form.mtProvider}
                  onChange={(e) => handleChange('mtProvider', e.target.value)}
                  disabled={isS2sPreset}
                >
                  {options.mtProvider.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
                <small>
                  {t('aiPipelineSettings.envDefault')}: {envDefaults.mtProvider}
                </small>
              </label>

              <label className="pipeline-field">
                <span>{t('aiPipelineSettings.ttsProvider')}</span>
                <select
                  value={form.ttsProvider}
                  onChange={(e) => handleChange('ttsProvider', e.target.value)}
                  disabled={isS2sPreset}
                >
                  {options.ttsProvider.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
                <small>
                  {t('aiPipelineSettings.envDefault')}: {envDefaults.ttsProvider}
                </small>
              </label>
            </>
          )}
        </section>

        <div className="settings-actions">
          <button
            type="button"
            className="btn-primary"
            data-testid="ai-pipeline-save"
            onClick={() => void handleSave()}
            disabled={isSaving}
          >
            {isSaving ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </main>
    </div>
  );
}
