/**
 * 利用履歴ページ
 * 自分が参加した会議室を一覧し、会議記録へ遷移する
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { authApi, ApiError, type ParticipationHistory } from '../api/client';
import { useAuthStore } from '../store/authStore';
import '../styles/pages/admin.css';
import '../styles/pages/history.css';

export function HistoryPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { logout, hasHydrated } = useAuthStore();
  const [items, setItems] = useState<ParticipationHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setItems(await authApi.getHistory());
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        logout();
        navigate('/login');
        return;
      }
      setError(t('history.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [logout, navigate, t]);

  useEffect(() => {
    if (hasHydrated) {
      void load();
    }
  }, [hasHydrated, load]);

  if (!hasHydrated || loading) {
    return (
      <div className="admin-page" data-testid="history-page">
        <div className="empty-state">
          <p>{t('common.loading')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-page history-page" data-testid="history-page">
      <header>
        <div className="header-left">
          <button type="button" onClick={() => navigate('/menu')}>
            {t('common.back')}
          </button>
          <h1>📊 {t('history.title')}</h1>
        </div>
      </header>

      {error && <div className="error">{error}</div>}

      <section className="admin-users">
        {items.length === 0 ? (
          <div className="empty-state" data-testid="history-empty">
            <p>{t('history.empty')}</p>
            <p>{t('history.emptyHint')}</p>
          </div>
        ) : (
          <div className="users-table-wrapper">
            <table className="users-table">
              <thead>
                <tr>
                  <th>{t('history.roomName')}</th>
                  <th>{t('history.visibility')}</th>
                  <th>{t('history.joinedAt')}</th>
                  <th>{t('history.updatedAt')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr
                    key={row.roomId}
                    className="history-row"
                    data-testid={`history-row-${row.roomId}`}
                    onClick={() => navigate(`/room/${row.roomId}/transcript`)}
                  >
                    <td>{row.roomName}</td>
                    <td>
                      {row.isPrivate ? t('history.private') : t('history.public')}
                    </td>
                    <td>{new Date(row.joinedAt).toLocaleString()}</td>
                    <td>{new Date(row.updatedAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
