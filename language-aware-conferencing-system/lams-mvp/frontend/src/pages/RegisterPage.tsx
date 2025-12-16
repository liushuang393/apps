/**
 * 登録ページ
 * 新規ユーザー登録フォーム
 */
import { useState, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { authApi } from '../api/client';
import { useAuthStore } from '../store/authStore';
import type { SupportedLanguage } from '../types';

/** 言語選択オプション */
const LANGUAGES: { value: SupportedLanguage; label: string }[] = [
  { value: 'ja', label: '日本語' },
  { value: 'en', label: '英語' },
  { value: 'zh', label: '中国語' },
  { value: 'vi', label: 'ベトナム語' },
];

export function RegisterPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [nativeLanguage, setNativeLanguage] = useState<SupportedLanguage>('ja');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);

  /** 登録処理 */
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await authApi.register(
        email,
        password,
        displayName,
        nativeLanguage
      );
      setAuth(res.access_token, res.user);
      navigate('/rooms');
    } catch (err) {
      setError(err instanceof Error ? err.message : '登録に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <form onSubmit={handleSubmit}>
        <h1>🌐 LAMS</h1>
        <p className="subtitle">新規アカウント登録</p>

        {error && <div className="error">{error}</div>}

        <div className="form-group">
          <label>メールアドレス</label>
          <input
            type="email"
            placeholder="your@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div className="form-group">
          <label>パスワード</label>
          <input
            type="password"
            placeholder="8文字以上"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
        </div>

        <div className="form-group">
          <label>表示名</label>
          <input
            type="text"
            placeholder="会議で表示される名前"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
          />
        </div>

        <div className="form-group">
          <label>母語（翻訳先のデフォルト言語）</label>
          <select
            value={nativeLanguage}
            onChange={(e) =>
              setNativeLanguage(e.target.value as SupportedLanguage)
            }
          >
            {LANGUAGES.map((lang) => (
              <option key={lang.value} value={lang.value}>
                {lang.label}
              </option>
            ))}
          </select>
        </div>

        <button type="submit" disabled={loading}>
          {loading ? '登録中...' : 'アカウント作成'}
        </button>
      </form>

      <p>
        アカウントがある場合は <Link to="/login">ログイン</Link>
      </p>
    </div>
  );
}
