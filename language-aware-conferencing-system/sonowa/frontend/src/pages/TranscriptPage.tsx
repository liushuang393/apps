/**
 * 会議記録ページ
 * 会議の字幕履歴を表示・エクスポート
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
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

import { LANGUAGE_NAMES } from '../constants/languages';
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
      setError('会議記録の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, [roomId, selectedLang, selectedSessionId, logout, navigate]);

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
    lines.push(`会議記録: ${transcript.roomName}`);
    lines.push(`エクスポート日時: ${new Date().toLocaleString('ja-JP')}`);
    lines.push(`言語: ${selectedLang ? LANGUAGE_NAMES[selectedLang as SupportedLanguage] || selectedLang : '原文'}`);
    lines.push('');
    lines.push('---');
    lines.push('');

    for (const sub of transcript.subtitles) {
      const time = new Date(sub.timestamp).toLocaleTimeString('ja-JP');
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
      setMinutesError('会議記録が空のため議事録を生成できません');
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
        setMinutesError('議事録生成は現在無効です（LLM 未設定）');
      } else if (err instanceof ApiError) {
        setMinutesError(err.message);
      } else {
        setMinutesError('議事録の生成に失敗しました');
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
      setRerunError('会議回を選択してください');
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
        setRerunError('離線再処理に利用可能な本地モデルがありません');
      } else if (err instanceof ApiError) {
        setRerunError(err.message);
      } else {
        setRerunError('離線再処理に失敗しました');
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
          <p>読み込み中...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="transcript-page">
        <header>
          <h1>📝 会議記録</h1>
          <div className="header-right">
            <button className="back-btn" onClick={() => navigate(-1)}>← 戻る</button>
          </div>
        </header>
        <div className="error">{error}</div>
      </div>
    );
  }

  return (
    <div className="transcript-page" data-testid="transcript-page">
      <header>
        <h1>📝 {transcript?.roomName || '会議記録'}</h1>
        <div className="header-right">
          <span className="user-name">{user?.displayName}</span>
          <button className="back-btn" onClick={() => navigate(-1)}>← 戻る</button>
        </div>
      </header>

      <div className="transcript-controls">
        <div className="language-selector">
          <label>表示言語:</label>
          <select
            value={selectedLang}
            onChange={(e) => setSelectedLang(e.target.value)}
          >
            <option value="">原文</option>
            {availableLanguages.map((lang) => (
              <option key={lang} value={lang}>
                {LANGUAGE_NAMES[lang]}
              </option>
            ))}
          </select>
        </div>
        <div className="language-selector">
          <label>会議回:</label>
          <select
            value={selectedSessionId}
            onChange={(e) => setSelectedSessionId(e.target.value)}
          >
            <option value="">最新 / 進行中</option>
            {transcript?.sessions.map((session) => (
              <option key={session.id} value={session.id}>
                {new Date(session.startedAt).toLocaleString('ja-JP')}
                {session.isActive ? '（進行中）' : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="export-buttons">
          <button onClick={exportAsText} disabled={!transcript?.subtitles.length}>
            テキストでエクスポート
          </button>
          <button
            type="button"
            data-testid="transcript-minutes-btn"
            onClick={() => void generateMinutes()}
            disabled={minutesLoading}
          >
            {minutesLoading ? '生成中...' : '議事録を生成'}
          </button>
          {isAdmin && (
            <button
              type="button"
              data-testid="transcript-rerun-btn"
              title={!activeSessionId ? '会議回を選択してください' : undefined}
              onClick={() => void triggerRerun()}
              disabled={rerunLoading || !activeSessionId}
            >
              {rerunLoading ? '再処理中...' : '離線再処理'}
            </button>
          )}
        </div>
      </div>

      {(minutesError || minutes) && (
        <section className="minutes-panel">
          <h2>議事録</h2>
          {minutesError && (
            <div className="error" data-testid="transcript-minutes-error">
              {minutesError}
            </div>
          )}
          {minutes && (
            <>
              <p className="minutes-meta">
                発言数: {minutes.segmentCount} / 生成: {minutes.provider}
              </p>
              <h3>要約</h3>
              <p>{minutes.summary}</p>
              <h3>決定事項</h3>
              <ul>
                {minutes.decisions.length === 0 ? (
                  <li>なし</li>
                ) : (
                  minutes.decisions.map((item) => <li key={item}>{item}</li>)
                )}
              </ul>
              <h3>ToDo</h3>
              <ul>
                {minutes.actionItems.length === 0 ? (
                  <li>なし</li>
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
          <h2>離線再処理</h2>
          {rerunError && <div className="error">{rerunError}</div>}
          {rerunSummary && (
            <p className="minutes-meta">
              対象 {rerunSummary.total} / 完了 {rerunSummary.done} / スキップ {rerunSummary.skipped} / 失敗 {rerunSummary.failed}
            </p>
          )}
        </section>
      )}

      <div className="transcript-content">
        {!transcript || transcript.subtitles.length === 0 ? (
          <div className="empty-state">
            <p>会議記録がありません</p>
            <p>会議中の発言が自動的に記録されます</p>
          </div>
        ) : (
          <div className="transcript-list">
            <div className="transcript-summary">
              <span>発言数: {transcript.total}</span>
              {transcript.selectedSessionId && (
                <span>
                  会議回: {new Date(
                    transcript.sessions.find((session) => session.id === transcript.selectedSessionId)?.startedAt
                    ?? Date.now()
                  ).toLocaleString('ja-JP')}
                </span>
              )}
            </div>
            {transcript.subtitles.map((sub) => (
              <div key={sub.id} className="transcript-item">
                <div className="transcript-meta">
                  <span className="speaker-name">{sub.speakerName}</span>
                  <span className="timestamp">
                    {new Date(sub.timestamp).toLocaleTimeString('ja-JP')}
                  </span>
                  <span className="original-lang" title="原文言語">
                    {LANGUAGE_NAMES[sub.originalLanguage as SupportedLanguage] || sub.originalLanguage}
                  </span>
                </div>
                <div className="transcript-text">
                  {getDisplayText(sub)}
                </div>
                {selectedLang && selectedLang !== sub.originalLanguage && sub.translations[selectedLang] && (
                  <div className="transcript-original">
                    <small>原文: {sub.originalText}</small>
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
