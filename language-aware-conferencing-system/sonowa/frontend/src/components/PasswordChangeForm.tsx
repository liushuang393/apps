/**
 * パスワード変更フォーム（プロフィール画面）
 * 目的: ログイン中の本人が、現在のパスワードを確認したうえで新しいパスワードへ変更する。
 * 注意: 忘れた場合はこのフォームではなく、管理者が発行する再設定リンクを使う。
 */
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { authApi, ApiError } from '../api/client';

/** バックエンドの MIN_PASSWORD_LENGTH と揃える */
const MIN_PASSWORD_LENGTH = 8;

export function PasswordChangeForm() {
  const { t } = useTranslation();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (newPassword !== confirmPassword) {
      setError(t('auth.passwordMismatch'));
      return;
    }
    setLoading(true);
    try {
      await authApi.changePassword(currentPassword, newPassword);
      setSuccess(t('profile.passwordChanged'));
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('profile.passwordChangeFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} data-testid="password-change-form">
      <h2>🔒 {t('profile.passwordTitle')}</h2>

      {error && <div className="error" data-testid="password-change-error">{error}</div>}
      {success && (
        <div className="success" data-testid="password-change-success">
          {success}
        </div>
      )}

      <div className="form-group">
        <label htmlFor="current-password">{t('profile.currentPassword')}</label>
        <input
          id="current-password"
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          required
        />
      </div>
      <div className="form-group">
        <label htmlFor="profile-new-password">{t('auth.newPassword')}</label>
        <input
          id="profile-new-password"
          type="password"
          autoComplete="new-password"
          placeholder={t('auth.passwordHint')}
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          minLength={MIN_PASSWORD_LENGTH}
          required
        />
      </div>
      <div className="form-group">
        <label htmlFor="profile-confirm-password">{t('auth.confirmPassword')}</label>
        <input
          id="profile-confirm-password"
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          minLength={MIN_PASSWORD_LENGTH}
          required
        />
      </div>
      <button type="submit" data-testid="password-change-submit" disabled={loading}>
        {loading ? t('common.saving') : t('profile.passwordChangeSubmit')}
      </button>
    </form>
  );
}
