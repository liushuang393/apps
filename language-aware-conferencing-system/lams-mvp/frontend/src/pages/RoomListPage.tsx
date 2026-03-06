/**
 * 会議室一覧ページ
 * 会議の作成・設定・一覧表示を管理
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { roomApi, ApiError } from '../api/client';
import { useAuthStore } from '../store/authStore';
import type { Room, SupportedLanguage, AudioMode } from '../types';

import { LANGUAGE_NAMES, DEFAULT_ENABLED_LANGUAGES } from '../constants/languages';

/** 全対応言語リスト（デフォルト言語を使用） */
const ALL_LANGUAGES = DEFAULT_ENABLED_LANGUAGES;

/** 会議作成フォームの初期状態 */
interface CreateFormState {
  name: string;
  description: string;
  allowedLanguages: SupportedLanguage[];
  defaultAudioMode: AudioMode;
  allowModeSwitch: boolean;
  isPrivate: boolean;
}

const initialFormState: CreateFormState = {
  name: '',
  description: '',
  allowedLanguages: ['ja', 'en', 'zh', 'vi'],
  defaultAudioMode: 'original',
  allowModeSwitch: true,
  isPrivate: false,
};

/**
 * 会議カード用の落ち着いた背景色パレット（企業向け）
 * HSL色空間で彩度と明度を控えめに設定
 */
const CARD_COLOR_PALETTE = [
  'hsl(210, 30%, 97%)',   // 薄い青
  'hsl(180, 25%, 96%)',   // 薄いシアン
  'hsl(150, 25%, 96%)',   // 薄い緑
  'hsl(30, 30%, 97%)',    // 薄いオレンジ
  'hsl(270, 20%, 97%)',   // 薄い紫
  'hsl(340, 25%, 97%)',   // 薄いピンク
  'hsl(60, 25%, 96%)',    // 薄い黄
  'hsl(0, 0%, 97%)',      // 薄いグレー
];

/**
 * 会議IDから一貫した色を取得（同じ会議は常に同じ色）
 */
const getCardColor = (roomId: string): string => {
  let hash = 0;
  for (let i = 0; i < roomId.length; i++) {
    const code = roomId.codePointAt(i) ?? 0;
    hash = ((hash << 5) - hash) + code;
    hash = hash & hash;
  }
  return CARD_COLOR_PALETTE[Math.abs(hash) % CARD_COLOR_PALETTE.length];
};

export function RoomListPage() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [formState, setFormState] = useState<CreateFormState>(initialFormState);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { user, logout, hasHydrated } = useAuthStore();

  /**
   * 会議室一覧を取得
   *
   * 入力: なし
   * 出力: state(rooms/loading/error)を更新
   * 注意: 認証エラー(401)相当の場合はログアウトしてログインページへ遷移する
   */
  const loadRooms = useCallback(async () => {
    try {
      setError(null);
      const res = await roomApi.list();
      setRooms(res.rooms || []); // 空配列の場合も正常に処理
    } catch (err) {
      // 認証エラー（トークン期限切れ等）: ログアウトしてログイン画面へ
      if (err instanceof ApiError && err.status === 401) {
        logout();
        navigate('/login');
        return;
      }
      // 404エラー（会議室が存在しない）: 空配列を設定してエラー表示しない
      if (err instanceof ApiError && err.status === 404) {
        setRooms([]);
        return;
      }
      // その他のエラーの場合のみエラーメッセージを表示
      setError('会議室一覧の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, [logout, navigate]);

  useEffect(() => {
    // hydration完了を待ってからデータ取得
    if (!hasHydrated) return;

    loadRooms();

    // 定期的に参加者数を更新（10秒間隔）
    const interval = setInterval(loadRooms, 10000);
    return () => clearInterval(interval);
  }, [hasHydrated, loadRooms]);

  /** 言語選択のトグル */
  const toggleLanguage = (lang: SupportedLanguage) => {
    setFormState((prev) => {
      const langs = prev.allowedLanguages.includes(lang)
        ? prev.allowedLanguages.filter((l) => l !== lang)
        : [...prev.allowedLanguages, lang];
      // 最低1言語は必須
      return { ...prev, allowedLanguages: langs.length > 0 ? langs : prev.allowedLanguages };
    });
  };

  /** 会議室作成処理 */
  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!formState.name.trim() || formState.allowedLanguages.length === 0) return;

    setCreating(true);
    try {
      const room = await roomApi.create({
        name: formState.name,
        description: formState.description || undefined,
        allowedLanguages: formState.allowedLanguages,
        defaultAudioMode: formState.defaultAudioMode,
        allowModeSwitch: formState.allowModeSwitch,
        isPrivate: formState.isPrivate,
      });
      navigate(`/room/${room.id}`);
    } catch {
      // エラーハンドリング
    } finally {
      setCreating(false);
    }
  };

  /** フォームをキャンセル */
  const handleCancel = () => {
    setShowCreate(false);
    setFormState(initialFormState);
  };

  /** ログアウト処理 */
  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  // hydration待ちまたはloading中
  if (!hasHydrated || loading) {
    return (
      <div className="room-list-page">
        <div className="empty-state">
          <p>読み込み中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="room-list-page">
      <header>
        <div className="header-left">
          <button className="back-btn" onClick={() => navigate('/menu')} title="メニューに戻る">
            ← 戻る
          </button>
          <h1>🌐 LAMS 会議室</h1>
        </div>
        <div className="user-info">
          <span className="user-name" title={user?.displayName}>{user?.displayName || '?'}</span>
          <button onClick={handleLogout}>ログアウト</button>
        </div>
      </header>

      {error && <div className="error">{error}</div>}

      <button onClick={() => setShowCreate(!showCreate)}>
        {showCreate ? 'キャンセル' : '新規会議室作成'}
      </button>

      {showCreate && (
        <form onSubmit={handleCreate} className="create-form">
          <h3>📋 新規会議室設定</h3>

          {/* 基本情報 */}
          <div className="form-group">
            <label>会議室名 *</label>
            <input
              type="text"
              placeholder="例：定例ミーティング"
              value={formState.name}
              onChange={(e) => setFormState((prev) => ({ ...prev, name: e.target.value }))}
              required
            />
          </div>

          {/* 会議説明 */}
          <div className="form-group">
            <label>会議説明</label>
            <textarea
              placeholder="例：週次進捗報告と課題共有"
              value={formState.description}
              onChange={(e) => setFormState((prev) => ({ ...prev, description: e.target.value }))}
              rows={2}
              maxLength={200}
            />
          </div>

          {/* 言語設定 */}
          <div className="form-group">
            <label>対応言語 *（参加者が選択可能な翻訳先言語）</label>
            <div className="language-checkboxes">
              {ALL_LANGUAGES.map((lang) => (
                <label key={lang}>
                  <input
                    type="checkbox"
                    checked={formState.allowedLanguages.includes(lang)}
                    onChange={() => toggleLanguage(lang)}
                  />
                  {LANGUAGE_NAMES[lang]}
                </label>
              ))}
            </div>
          </div>

          {/* 音声モード設定 */}
          <div className="form-row">
            <div className="form-group">
              <label>デフォルト音声モード</label>
              <select
                value={formState.defaultAudioMode}
                onChange={(e) => setFormState((prev) => ({
                  ...prev,
                  defaultAudioMode: e.target.value as AudioMode
                }))}
              >
                <option value="original">原音（オリジナル音声）</option>
                <option value="translated">翻訳音声</option>
              </select>
            </div>
          </div>

          {/* モード切替許可 */}
          <div className="toggle-group">
            <label htmlFor="allow-mode-switch">参加者による音声モード切替を許可</label>
            <button
              type="button"
              id="allow-mode-switch"
              className={`toggle-switch ${formState.allowModeSwitch ? 'active' : ''}`}
              onClick={() => setFormState((prev) => ({ ...prev, allowModeSwitch: !prev.allowModeSwitch }))}
              aria-pressed={formState.allowModeSwitch}
            />
            <span>{formState.allowModeSwitch ? '許可' : '禁止'}</span>
          </div>

          {/* 私有/公開設定 - 双方向切替式 */}
          <div className="toggle-group private-toggle">
            <span className={`toggle-label ${!formState.isPrivate ? 'toggle-label--active' : ''}`}>
              🌐 公開
            </span>
            <button
              type="button"
              id="is-private"
              className={`toggle-switch ${formState.isPrivate ? 'active' : ''}`}
              onClick={() => setFormState((prev) => ({ ...prev, isPrivate: !prev.isPrivate }))}
              aria-pressed={formState.isPrivate}
              aria-label="会議の公開設定を切り替え"
            />
            <span className={`toggle-label ${formState.isPrivate ? 'toggle-label--active' : ''}`}>
              🔒 私有
            </span>
          </div>
          <div className="private-notice">
            <span>💡</span>
            <span>
              {formState.isPrivate
                ? '私有会議：自分のみが一覧で確認・入室できます'
                : '公開会議：全メンバーが一覧で確認・入室できます'}
            </span>
          </div>

          {/* ボタン */}
          <div className="form-actions">
            <button type="button" className="btn-secondary" onClick={handleCancel}>
              キャンセル
            </button>
            <button type="submit" disabled={creating || !formState.name.trim()}>
              {creating ? '作成中...' : '会議室を作成'}
            </button>
          </div>
        </form>
      )}

      <div className="room-grid">
        {rooms.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">🏢</div>
            <h2>会議室がありません</h2>
            <p>まだ会議室が作成されていません</p>
            <p className="empty-hint">上の「新規会議室作成」ボタンをクリックして、最初の会議室を作成しましょう</p>
          </div>
        ) : (
          rooms.map((room) => (
            <article
              key={room.id}
              className={`room-card ${room.isPrivate ? 'room-card--private' : ''}`}
              style={{ backgroundColor: getCardColor(room.id) }}
              onClick={() => navigate(`/room/${room.id}`)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') navigate(`/room/${room.id}`); }}
              tabIndex={0}
              role="button"
              aria-label={`${room.name}に参加${room.isPrivate ? '（私有会議）' : ''}`}
            >
              {/* 私有/公開バッジ */}
              <div className="room-card-badge">
                {room.isPrivate ? (
                  <span className="badge badge--private" title="私有会議：自分のみ参加可能">
                    🔒 私有
                  </span>
                ) : (
                  <span className="badge badge--public" title="公開会議：全メンバー参加可能">
                    🌐 公開
                  </span>
                )}
              </div>

              <h3>{room.name}</h3>
              <p>{room.description || '会議概要なし'}</p>
              <div className="room-meta">
                <span className="participant-count">
                  👥 {room.participantCount}
                </span>
                <div className="languages">
                  {(room.allowedLanguages ?? []).slice(0, 3).map((lang) => (
                    <span key={lang} className="language-tag">
                      {LANGUAGE_NAMES[lang] ?? lang}
                    </span>
                  ))}
                  {(room.allowedLanguages?.length ?? 0) > 3 && (
                    <span className="language-tag">+{room.allowedLanguages.length - 3}</span>
                  )}
                </div>
              </div>
            </article>
          ))
        )}
      </div>
    </div>
  );
}
