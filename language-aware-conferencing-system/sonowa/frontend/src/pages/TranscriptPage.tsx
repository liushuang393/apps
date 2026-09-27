/**
 * 会議記録ページ
 * 会議の字幕履歴を表示・エクスポート
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  adminApi,
  roomApi,
  ApiError,
  type MinutesData,
  type RerunSummary,
  type SubtitleRecord,
  type TranscriptData,
} from '../api/client';
import { useAuthStore } from '../store/authStore';
import type { SupportedLanguage } from '../types';

import { languageName } from '../constants/languageNames';
import '../styles/pages/transcript.css';

export function TranscriptPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const [transcript, setTranscript] = useState<TranscriptData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedLang, setSelectedLang] = useState<string>('');
  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [availableLanguages, setAvailableLanguages] = useState<SupportedLanguage[]>([]);
  const [minutes, setMinutes] = useState<MinutesData | null>(null);
  const [minutesError, setMinutesError] = useState<string | null>(null);
  const [minutesLoading, setMinutesLoading] = useState(false);
  const [rerunSummary, setRerunSummary] = useState<RerunSummary | null>(null);
  const [rerunError, setRerunError] = useState<string | null>(null);
  const [rerunLoading, setRerunLoading] = useState(false);
  const navigate = useNavigate();
  const { user, logout, hasHydrated } = useAuthStore();
  const { t, i18n } = useTranslation();
  const isAdmin = user?.role === 'admin';
  const activeSessionId = selectedSessionId || transcript?.selectedSessionId || '';

  /**
   * 会議記録を取得
   */
  const loadTranscript = useCallback(async () => {
    if (!roomId) return;

    try {
      setLoading(true);
      setError(null);
      const [data, languageSettings] = await Promise.all([
        roomApi.getTranscript(roomId, selectedLang || undefined, selectedSessionId || undefined),
        adminApi.getLanguageSettings(),
      ]);
      setTranscript(data);
      setAvailableLanguages(languageSettings.enabledLanguages as SupportedLanguage[]);
    } catch (err) {
      // 認証エラー（トークン期限切れ等）: ログアウトしてログイン画面へ
      if (err instanceof ApiError && err.status === 401) {
        logout();
        navigate('/login');
        return;
      }
      setError(t('transcript.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [roomId, selectedLang, selectedSessionId, logout, navigate, t]);

  useEffect(() => {
    if (!hasHydrated) return;
    loadTranscript();
  }, [hasHydrated, loadTranscript]);

  /**
   * テキスト形式でエクスポート
   */
  const exportAsText = () => {
    if (!transcript) return;

    const lines: string[] = [];
    lines.push(t('transcript.exportTitle', { name: transcript.roomName }));
    lines.push(t('transcript.exportDate', { date: new Date().toLocaleString(i18n.language) }));
    lines.push(t('transcript.exportLanguage', {
      language: selectedLang
        ? languageName(selectedLang, i18n.language)
        : t('settings.originalText'),
    }));
    lines.push('');
    lines.push('---');
    lines.push('');

    for (const sub of transcript.subtitles) {
      const time = new Date(sub.timestamp).toLocaleTimeString(i18n.language);
      const text = selectedLang && sub.translations[selectedLang]
        ? sub.translations[selectedLang]
        : sub.originalText;
      lines.push(`[${time}] ${sub.speakerName}: ${text}`);
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transcript_${transcript.roomName}_${new Date().toISOString().slice(0,10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /**
   * 議事録をオンデマンド生成する。
   * 出力言語は表示言語、未選択時はユーザー母語。
   */
  const generateMinutes = async () => {
    if (!roomId) return;
    if (!transcript?.subtitles.length) {
      setMinutes(null);
      setMinutesError(t('transcript.minutesEmpty'));
      return;
    }
    const lang = selectedLang || user?.nativeLanguage || 'ja';
    try {
      setMinutesLoading(true);
      setMinutesError(null);
      setMinutes(
        await roomApi.getMinutes(roomId, lang, selectedSessionId || undefined)
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        logout();
        navigate('/login');
        return;
      }
      if (err instanceof ApiError && err.status === 503) {
        setMinutesError(t('transcript.minutesDisabled'));
      } else if (err instanceof ApiError) {
        setMinutesError(err.message);
      } else {
        setMinutesError(t('transcript.minutesFailed'));
      }
      setMinutes(null);
    } finally {
      setMinutesLoading(false);
    }
  };

  /**
   * 管理者向け離線再処理。本地モデル未導入時は 503 を表示する。
   */
  const triggerRerun = async () => {
    if (!activeSessionId) {
      setRerunError(t('transcript.selectSession'));
      return;
    }
    try {
      setRerunLoading(true);
      setRerunError(null);
      setRerunSummary(await adminApi.rerunSession(activeSessionId));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        logout();
        navigate('/login');
        return;
      }
      if (err instanceof ApiError && err.status === 503) {
        setRerunError(t('transcript.rerunNoModel'));
      } else if (err instanceof ApiError) {
        setRerunError(err.message);
      } else {
        setRerunError(t('transcript.rerunFailed'));
      }
      setRerunSummary(null);
    } finally {
      setRerunLoading(false);
    }
  };

  /**
   * 表示テキストを取得（言語選択に応じて）
   */
  const getDisplayText = (sub: SubtitleRecord): string => {
    if (selectedLang && sub.translations[selectedLang]) {
      return sub.translations[selectedLang];
    }
    if (selectedLang && selectedLang === sub.originalLanguage) {
      return sub.originalText;
    }
    return sub.originalText;
  };

  if (!hasHydrated || loading) {
    return (
      <div className="transcript-page">
        <div className="empty-state">
          <p>{t('common.loading')}</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="transcript-page">
        <header>
          <h1>📝 {t('transcript.name')}</h1>
          <div className="header-right">
            <button className="back-btn" onClick={() => navigate(-1)}>{t('common.backArrow')}</button>
          </div>
        </header>
        <div className="error">{error}</div>
      </div>
    );
  }

  return (
    <div className="transcript-page" data-testid="transcript-page">
      <header>
        <h1>📝 {transcript?.roomName || t('transcript.name')}</h1>
        <div className="header-right">
          <span className="user-name">{user?.displayName}</span>
          <button className="back-btn" onClick={() => navigate(-1)}>{t('common.backArrow')}</button>
        </div>
      </header>

      <div className="transcript-controls">
        <div className="language-selector">
          <label>{t('transcript.displayLanguage')}</label>
          <select
            value={selectedLang}
            onChange={(e) => setSelectedLang(e.target.value)}
          >
            <option value="">{t('settings.originalText')}</option>
            {availableLanguages.map((lang) => (
              <option key={lang} value={lang}>
                {languageName(lang, i18n.language)}
              </option>
            ))}
          </select>
        </div>
        <div className="language-selector">
          <label>{t('transcript.sessionLabel')}</label>
          <select
            value={selectedSessionId}
            onChange={(e) => setSelectedSessionId(e.target.value)}
          >
            <option value="">{t('transcript.latestSession')}</option>
            {transcript?.sessions.map((session) => (
              <option key={session.id} value={session.id}>
                {session.isActive
                  ? t('transcript.sessionActive', { date: new Date(session.startedAt).toLocaleString(i18n.language) })
                  : new Date(session.startedAt).toLocaleString(i18n.language)}
              </option>
            ))}
          </select>
        </div>
        <div className="export-buttons">
          <button onClick={exportAsText} disabled={!transcript?.subtitles.length}>
            {t('transcript.exportText')}
          </button>
          <button
            type="button"
            data-testid="transcript-minutes-btn"
            onClick={() => void generateMinutes()}
            disabled={minutesLoading}
          >
            {minutesLoading ? t('transcript.generating') : t('transcript.generateMinutes')}
          </button>
          {isAdmin && (
            <button
              type="button"
              data-testid="transcript-rerun-btn"
              title={!activeSessionId ? t('transcript.selectSession') : undefined}
              onClick={() => void triggerRerun()}
              disabled={rerunLoading || !activeSessionId}
            >
              {rerunLoading ? t('transcript.rerunning') : t('transcript.rerun')}
            </button>
          )}
        </div>
      </div>

      {(minutesError || minutes) && (
        <section className="minutes-panel">
          <h2>{t('transcript.minutes')}</h2>
          {minutesError && (
            <div className="error" data-testid="transcript-minutes-error">
              {minutesError}
            </div>
          )}
          {minutes && (
            <>
              <p className="minutes-meta">
                {t('transcript.minutesMeta', { segments: minutes.segmentCount, provider: minutes.provider })}
              </p>
              <h3>{t('transcript.summary')}</h3>
              <p>{minutes.summary}</p>
              <h3>{t('transcript.decisions')}</h3>
              <ul>
                {minutes.decisions.length === 0 ? (
                  <li>{t('transcript.none')}</li>
                ) : (
                  minutes.decisions.map((item) => <li key={item}>{item}</li>)
                )}
              </ul>
              <h3>ToDo</h3>
              <ul>
                {minutes.actionItems.length === 0 ? (
                  <li>{t('transcript.none')}</li>
                ) : (
                  minutes.actionItems.map((item) => <li key={item}>{item}</li>)
                )}
              </ul>
            </>
          )}
        </section>
      )}

      {(rerunError || rerunSummary) && (
        <section className="minutes-panel">
          <h2>{t('transcript.rerun')}</h2>
          {rerunError && <div className="error">{rerunError}</div>}
          {rerunSummary && (
            <p className="minutes-meta">
              {t('transcript.rerunSummary', {
                total: rerunSummary.total,
                done: rerunSummary.done,
                skipped: rerunSummary.skipped,
                failed: rerunSummary.failed,
              })}
            </p>
          )}
        </section>
      )}

      <div className="transcript-content">
        {!transcript || transcript.subtitles.length === 0 ? (
          <div className="empty-state">
            <p>{t('transcript.empty')}</p>
            <p>{t('transcript.emptyHint')}</p>
          </div>
        ) : (
          <div className="transcript-list">
            <div className="transcript-summary">
              <span>{t('transcript.total', { total: transcript.total })}</span>
              {transcript.selectedSessionId && (
                <span>
                  {t('transcript.sessionWithDate', {
                    date: new Date(
                      transcript.sessions.find((session) => session.id === transcript.selectedSessionId)?.startedAt
                      ?? Date.now()
                    ).toLocaleString(i18n.language),
                  })}
                </span>
              )}
            </div>
            {transcript.subtitles.map((sub) => (
              <div key={sub.id} className="transcript-item">
                <div className="transcript-meta">
                  <span className="speaker-name">{sub.speakerName}</span>
                  <span className="timestamp">
                    {new Date(sub.timestamp).toLocaleTimeString(i18n.language)}
                  </span>
                  <span className="original-lang" title={t('transcript.originalLanguageTitle')}>
                    {languageName(sub.originalLanguage, i18n.language)}
                  </span>
                </div>
                <div className="transcript-text">
                  {getDisplayText(sub)}
                </div>
                {selectedLang && selectedLang !== sub.originalLanguage && sub.translations[selectedLang] && (
                  <div className="transcript-original">
                    <small>{t('transcript.originalWithText', { text: sub.originalText })}</small>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
