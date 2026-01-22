/**
 * 管理者ページ
 * ユーザー管理、システム統計
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminApi, type AdminUser, type SystemStats } from '../api/client';
import { useAuthStore } from '../store/authStore';
import type { SupportedLanguage } from '../types';

/** 言語表示名マッピング */
const LANGUAGE_NAMES: Record<SupportedLanguage, string> = {
  ja: '日本語',
  en: '英語',
  zh: '中国語',
  vi: 'ベトナム語',
};

/** ロール表示名マッピング */
const ROLE_NAMES: Record<string, string> = {
  admin: '管理者',
  moderator: 'モデレーター',
  user: '一般ユーザー',
};

export function AdminPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [saving, setSaving] = useState(false);
  const navigate = useNavigate();
  const { user, logout, hasHydrated } = useAuthStore();

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
      if (err instanceof Error) {
        if (err.message.includes('401')) {
          logout();
          navigate('/login');
          return;
        }
        if (err.message.includes('403')) {
          setError('管理者権限が必要です');
          return;
        }
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  }, [logout, navigate]);

  useEffect(() => {
    if (!hasHydrated) return;
    if (user?.role !== 'admin') {
      setError('管理者権限が必要です');
      setLoading(false);
      return;
    }
    loadData();
  }, [hasHydrated, user, loadData]);

  /**
   * ユーザー更新
   */
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
      <div className="admin-page">
        <div className="empty-state">
          <p>読み込み中...</p>
        </div>
      </div>
    );
  }

  if (error && !users.length) {
    return (
      <div className="admin-page">
        <header>
          <button onClick={() => navigate('/menu')}>戻る</button>
          <h1>管理者パネル</h1>
        </header>
        <div className="error">{error}</div>
      </div>
    );
  }

  return (
    <div className="admin-page">
      <header>
        <div className="header-left">
          <button onClick={() => navigate('/menu')}>戻る</button>
          <h1>管理者パネル</h1>
        </div>
        <div className="header-right">
          <span className="user-name">{user?.displayName}</span>
        </div>
      </header>

      {error && <div className="error">{error}</div>}

      {/* システム統計 */}
      {stats && (
        <section className="admin-stats">
          <h2>システム統計</h2>
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-value">{stats.totalUsers}</div>
              <div className="stat-label">総ユーザー数</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{stats.activeUsers}</div>
              <div className="stat-label">アクティブユーザー</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{stats.totalRooms}</div>
              <div className="stat-label">総会議室数</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{stats.activeRooms}</div>
              <div className="stat-label">アクティブ会議室</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{stats.totalSubtitles}</div>
              <div className="stat-label">総発言記録数</div>
            </div>
          </div>
        </section>
      )}

      {/* ユーザー管理 */}
      <section className="admin-users">
        <h2>ユーザー管理</h2>
        <div className="users-table-wrapper">
          <table className="users-table">
            <thead>
              <tr>
                <th>表示名</th>
                <th>メールアドレス</th>
                <th>言語</th>
                <th>ロール</th>
                <th>状態</th>
                <th>登録日</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className={!u.isActive ? 'inactive' : ''}>
                  <td>{u.displayName}</td>
                  <td>{u.email}</td>
                  <td>{LANGUAGE_NAMES[u.nativeLanguage as SupportedLanguage] || u.nativeLanguage}</td>
                  <td>
                    <span className={`role-badge role-${u.role}`}>
                      {ROLE_NAMES[u.role] || u.role}
                    </span>
                  </td>
                  <td>
                    <span className={`status-badge ${u.isActive ? 'active' : 'inactive'}`}>
                      {u.isActive ? '有効' : '無効'}
                    </span>
                  </td>
                  <td>{new Date(u.createdAt).toLocaleDateString('ja-JP')}</td>
                  <td>
                    <button
                      className="edit-btn"
                      onClick={() => setEditingUser(u)}
                      disabled={u.id === user?.id}
                    >
                      編集
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
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>ユーザー編集</h3>
            <div className="form-group">
              <label>表示名</label>
              <input
                type="text"
                value={editingUser.displayName}
                onChange={(e) => setEditingUser({ ...editingUser, displayName: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>ロール</label>
              <select
                value={editingUser.role}
                onChange={(e) => setEditingUser({ ...editingUser, role: e.target.value })}
              >
                <option value="user">一般ユーザー</option>
                <option value="moderator">モデレーター</option>
                <option value="admin">管理者</option>
              </select>
            </div>
            <div className="form-group">
              <label>状態</label>
              <select
                value={editingUser.isActive ? 'active' : 'inactive'}
                onChange={(e) => setEditingUser({ ...editingUser, isActive: e.target.value === 'active' })}
              >
                <option value="active">有効</option>
                <option value="inactive">無効</option>
              </select>
            </div>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setEditingUser(null)}>
                キャンセル
              </button>
              <button onClick={handleUpdateUser} disabled={saving}>
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
