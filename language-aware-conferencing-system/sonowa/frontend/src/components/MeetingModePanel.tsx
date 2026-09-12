/**
 * 会議AI主線（a/b/hybrid）切替パネル
 * 部屋作成者またはモデレーターのみ表示。受聴の原音/翻訳切替とは別概念。
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, meetingsApi } from '../api/client';
import type { MeetingMode, MeetingSessionInfo, User } from '../types';

interface MeetingModePanelProps {
  roomId: string;
  creatorId: string;
  user: User | null;
  roomDefaultMode?: MeetingMode;
}

const MODE_OPTIONS: MeetingMode[] = ['a', 'b', 'hybrid'];

export function MeetingModePanel({
  roomId,
  creatorId,
  user,
  roomDefaultMode = 'hybrid',
}: MeetingModePanelProps) {
  const { t } = useTranslation();
  const [session, setSession] = useState<MeetingSessionInfo | null>(null);
  const [mode, setMode] = useState<MeetingMode>(roomDefaultMode);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const canManage =
    !!user &&
    (user.id === creatorId || user.role === 'admin' || user.role === 'moderator');

  useEffect(() => {
    if (!canManage) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        let active = await meetingsApi.getActive(roomId);
        if (!active) {
          active = await meetingsApi.start(roomId, { mode: roomDefaultMode });
        }
        if (cancelled) return;
        setSession(active);
        setMode(active.mode);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 403) {
          setError(null);
        } else {
          setError(err instanceof Error ? err.message : t('meetingMode.loadError'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [canManage, roomId, roomDefaultMode, t]);

  const handleChange = useCallback(
    async (next: MeetingMode) => {
      if (!session || next === mode) return;
      setSaving(true);
      setError(null);
      setMessage(null);
      try {
        const updated = await meetingsApi.updateMode(session.id, { mode: next });
        setSession(updated);
        setMode(updated.mode);
        setMessage(t('meetingMode.saveSuccess'));
      } catch (err) {
        setError(err instanceof Error ? err.message : t('meetingMode.saveError'));
      } finally {
        setSaving(false);
      }
    },
    [session, mode, t]
  );

  if (!canManage) {
    return null;
  }

  return (
    <section className="meeting-mode-panel" aria-label={t('meetingMode.title')}>
      <h3>{t('meetingMode.title')}</h3>
      <p className="hint-text">{t('meetingMode.description')}</p>
      {loading ? (
        <p>{t('common.loading')}</p>
      ) : (
        <div className="meeting-mode-options">
          {MODE_OPTIONS.map((opt) => (
            <button
              key={opt}
              type="button"
              className={`meeting-mode-option ${mode === opt ? 'active' : ''}`}
              disabled={saving}
              onClick={() => void handleChange(opt)}
            >
              {t(`aiPipelineSettings.mode.${opt}`)}
            </button>
          ))}
        </div>
      )}
      {error && <div className="error-message">{error}</div>}
      {message && <div className="success-message">{message}</div>}
    </section>
  );
}
