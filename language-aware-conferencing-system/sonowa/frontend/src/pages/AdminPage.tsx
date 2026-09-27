/**
 * 管理者ページ
 * ユーザー管理、システム統計
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { adminApi, ApiError, type AdminUser, type SystemStats } from '../api/client';
import { LoadError } from '../components/LoadError';
import { useAuthStore } from '../store/authStore';

import { ALL_LANGUAGE_CODES } from '../constants/languages';
import { languageName } from '../constants/languageNames';
import '../styles/pages/admin.css';

/** 表示名を持つロール（それ以外はロール値をそのまま表示） */
const KNOWN_ROLES = new Set(['admin', 'moderator', 'user']);

export function AdminPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [saving, setSaving] = useState(false);
  const [resetLink, setResetLink] = useState<string | null>(null);
  const navigate = useNavigate();
  const { user, logout, hasHydrated } = useAuthStore();
  const { t, i18n } = useTranslation();

  /** ロール表示名（未知のロールは値をそのまま返す） */
  const roleLabel = (role: string | undefined): string | undefined =>
    role && KNOWN_ROLES.has(role) ? t(`role.${role}`) : role;

  /**
   * データ読み込み
   */
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [usersData, statsData] = await Promise.all([
        adminApi.listUsers(),
        adminApi.getStats(),
      ]);
      setUsers(usersData);
      setStats(statsData);
    } catch (err) {
      // 認証エラー（トークン期限切れ等）: ログアウトしてログイン画面へ
      if (err instanceof ApiError && err.status === 401) {
        logout();
        navigate('/login');
        return;
      }
      // 権限エラー: 管理者専用ページのため適切なメッセージを表示
      if (err instanceof ApiError && err.status === 403) {
        setError(t('glossary.adminRequired'));
        return;
      }
      // その他のエラー: 汎用メッセージを表示（内部エラー詳細は露出しない）
      setError(t('admin.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [logout, navigate, t]);

  useEffect(() => {
    if (!hasHydrated) return;
    if (user?.role !== 'admin') {
      setError(t('glossary.adminRequired'));
      setLoading(false);
      return;
    }
    loadData();
  }, [hasHydrated, user, loadData, t]);

  /**
   * ユーザー更新
   */
  /** パスワード再設定リンクを発行し、本人へ渡す URL を表示する */
  const handleIssueResetLink = async (userId: string) => {
    try {
      const { resetToken } = await adminApi.issuePasswordReset(userId);
      setResetLink(
        `${window.location.origin}/reset-password?token=${encodeURIComponent(resetToken)}`
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('admin.resetLinkFailed'));
    }
  };

  const handleUpdateUser = async () => {
    if (!editingUser) return;

    try {
      setSaving(true);
      await adminApi.updateUser(editingUser.id, {
        displayName: editingUser.displayName,
        nativeLanguage: editingUser.nativeLanguage,
        role: editingUser.role,
        isActive: editingUser.isActive,
      });
      setEditingUser(null);
      await loadData();
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      }
    } finally {
      setSaving(false);
    }
  };

  if (!hasHydrated || loading) {
    return (
      <div className="admin-page" data-testid="admin-page">
        <div className="empty-state">
          <p>{t('common.loading')}</p>
        </div>
      </div>
    );
  }

  if (error && !users.length) {
    return (
      <div className="admin-page" data-testid="admin-page">
        <header>
          <button onClick={() => navigate('/menu')}>{t('common.back')}</button>
          <h1>{t('menu.admin')}</h1>
        </header>
        <LoadError message={error} onRetry={() => void loadData()} testIdPrefix="admin" />
      </div>
    );
  }

  return (
    <div className="admin-page" data-testid="admin-page">
      <header>
        <div className="header-left">
          <button onClick={() => navigate('/menu')}>{t('common.back')}</button>
          <h1>{t('menu.admin')}</h1>
        </div>
        <div className="header-right">
          <span className="user-name">{user?.displayName}</span>
          <span
            className={`user-role role-${user?.role ?? 'user'}`}
            data-testid="admin-user-role"
            data-role={user?.role ?? 'user'}
          >
            {roleLabel(user?.role ?? 'user')}
          </span>
        </div>
      </header>

      {error && <div className="error">{error}</div>}

      {/* システム統計 */}
      {stats && (
        <section className="admin-stats">
          <h2>{t('admin.statsTitle')}</h2>
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-value">{stats.totalUsers}</div>
              <div className="stat-label">{t('admin.totalUsers')}</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{stats.activeUsers}</div>
              <div className="stat-label">{t('admin.activeUsers')}</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{stats.totalRooms}</div>
              <div className="stat-label">{t('admin.totalRooms')}</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{stats.activeRooms}</div>
              <div className="stat-label">{t('admin.activeRooms')}</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{stats.totalSubtitles}</div>
              <div className="stat-label">{t('admin.totalSubtitles')}</div>
            </div>
          </div>
        </section>
      )}

      {/* ユーザー管理 */}
      <section className="admin-users">
        <h2>{t('admin.usersTitle')}</h2>
        <div className="users-table-wrapper">
          <table className="users-table">
            <thead>
              <tr>
                <th>{t('auth.displayName')}</th>
                <th>{t('auth.email')}</th>
                <th>{t('admin.language')}</th>
                <th>{t('admin.role')}</th>
                <th>{t('admin.status')}</th>
                <th>{t('admin.registeredAt')}</th>
                <th>{t('admin.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className={!u.isActive ? 'inactive' : ''}>
                  <td>{u.displayName}</td>
                  <td>{u.email}</td>
                  <td>{languageName(u.nativeLanguage, i18n.language)}</td>
                  <td>
                    <span className={`role-badge role-${u.role}`}>
                      {roleLabel(u.role)}
                    </span>
                  </td>
                  <td>
                    <span className={`status-badge ${u.isActive ? 'active' : 'inactive'}`}>
                      {u.isActive ? t('glossary.enabled') : t('glossary.disabled')}
                    </span>
                  </td>
                  <td>{new Date(u.createdAt).toLocaleDateString(i18n.language)}</td>
                  <td>
                    <button
                      className="edit-btn"
                      data-testid={`admin-edit-${u.email}`}
                      onClick={() => {
                        setEditingUser(u);
                        setResetLink(null);
                      }}
                      disabled={u.id === user?.id}
                    >
                      {t('common.edit')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 編集モーダル */}
      {editingUser && (
        <div className="modal-overlay" onClick={() => setEditingUser(null)}>
            <div
              className="modal-content"
              data-testid="admin-user-edit-modal"
              onClick={(e) => e.stopPropagation()}
            >
            <h3>{t('admin.editTitle')}</h3>
            <div className="form-group">
              <label>{t('auth.displayName')}</label>
              <input
                type="text"
                value={editingUser.displayName}
                onChange={(e) => setEditingUser({ ...editingUser, displayName: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>{t('auth.nativeLanguage')}</label>
              <select
                data-testid="admin-user-native-language"
                value={editingUser.nativeLanguage}
                onChange={(e) =>
                  setEditingUser({ ...editingUser, nativeLanguage: e.target.value })
                }
              >
                {ALL_LANGUAGE_CODES.map((code) => (
                  <option key={code} value={code}>
                    {languageName(code, i18n.language)}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>{t('admin.role')}</label>
              <select
                value={editingUser.role}
                onChange={(e) => setEditingUser({ ...editingUser, role: e.target.value })}
              >
                <option value="user">{t('admin.roleOptionUser')}</option>
                <option value="moderator">{t('role.moderator')}</option>
                <option value="admin">{t('role.admin')}</option>
              </select>
            </div>
            <div className="form-group">
              <label>{t('admin.status')}</label>
              <select
                value={editingUser.isActive ? 'active' : 'inactive'}
                onChange={(e) => setEditingUser({ ...editingUser, isActive: e.target.value === 'active' })}
              >
                <option value="active">{t('glossary.enabled')}</option>
                <option value="inactive">{t('glossary.disabled')}</option>
              </select>
            </div>
            <div className="form-group">
              <label>{t('admin.passwordReset')}</label>
              <button
                type="button"
                className="btn-reset-link"
                data-testid="admin-issue-reset-link"
                onClick={() => void handleIssueResetLink(editingUser.id)}
              >
                {t('admin.issueResetLink')}
              </button>
              {resetLink && (
                <>
                  <input
                    type="text"
                    readOnly
                    value={resetLink}
                    data-testid="admin-reset-link"
                    onFocus={(e) => e.target.select()}
                  />
                  <p className="hint-text">
                    {t('admin.resetLinkHint')}
                  </p>
                </>
              )}
            </div>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setEditingUser(null)}>
                {t('common.cancel')}
              </button>
              <button onClick={handleUpdateUser} disabled={saving}>
                {saving ? t('common.saving') : t('common.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
