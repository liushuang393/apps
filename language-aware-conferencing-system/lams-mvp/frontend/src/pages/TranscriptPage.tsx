/**
 * 会議記録ページ
 * 会議の字幕履歴を表示・エクスポート
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { roomApi, ApiError, type SubtitleRecord, type TranscriptData } from '../api/client';
import { useAuthStore } from '../store/authStore';
import type { SupportedLanguage } from '../types';

import { LANGUAGE_NAMES, DEFAULT_ENABLED_LANGUAGES } from '../constants/languages';

/** 全対応言語リスト */
const ALL_LANGUAGES = DEFAULT_ENABLED_LANGUAGES;

export function TranscriptPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const [transcript, setTranscript] = useState<TranscriptData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedLang, setSelectedLang] = useState<string>('');
  const navigate = useNavigate();
  const { user, logout, hasHydrated } = useAuthStore();

  /**
   * 会議記録を取得
   */
  const loadTranscript = useCallback(async () => {
    if (!roomId) return;

    try {
      setLoading(true);
      setError(null);
      const data = await roomApi.getTranscript(roomId, selectedLang || undefined);
      setTranscript(data);
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
  }, [roomId, selectedLang, logout, navigate]);

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
    <div className="transcript-page">
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
            {ALL_LANGUAGES.map((lang) => (
              <option key={lang} value={lang}>
                {LANGUAGE_NAMES[lang]}
              </option>
            ))}
          </select>
        </div>
        <div className="export-buttons">
          <button onClick={exportAsText} disabled={!transcript?.subtitles.length}>
            テキストでエクスポート
          </button>
        </div>
      </div>

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
