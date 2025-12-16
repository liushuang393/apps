/**
 * 会議室一覧ページ
 * 会議の作成・設定・一覧表示を管理
 */
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { roomApi } from '../api/client';
import { useAuthStore } from '../store/authStore';
import type { Room, SupportedLanguage, AudioMode } from '../types';

/** 言語表示名マッピング */
const LANGUAGE_NAMES: Record<SupportedLanguage, string> = {
  ja: '日本語',
  en: '英語',
  zh: '中国語',
  vi: 'ベトナム語',
};

/** 全対応言語リスト */
const ALL_LANGUAGES: SupportedLanguage[] = ['ja', 'en', 'zh', 'vi'];

/** 会議作成フォームの初期状態 */
interface CreateFormState {
  name: string;
  allowedLanguages: SupportedLanguage[];
  defaultAudioMode: AudioMode;
  allowModeSwitch: boolean;
}

const initialFormState: CreateFormState = {
  name: '',
  allowedLanguages: ['ja', 'en', 'zh', 'vi'],
  defaultAudioMode: 'original',
  allowModeSwitch: true,
};

export function RoomListPage() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [formState, setFormState] = useState<CreateFormState>(initialFormState);
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();

  useEffect(() => {
    loadRooms();

    // 定期的に参加者数を更新（10秒間隔）
    const interval = setInterval(loadRooms, 10000);
    return () => clearInterval(interval);
  }, []);

  /** 会議室一覧を取得 */
  const loadRooms = async () => {
    try {
      const res = await roomApi.list();
      setRooms(res.rooms);
    } catch {
      // エラーハンドリング: UIでエラーを表示する場合はstateを追加
    } finally {
      setLoading(false);
    }
  };

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
        allowedLanguages: formState.allowedLanguages,
        defaultAudioMode: formState.defaultAudioMode,
        allowModeSwitch: formState.allowModeSwitch,
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

  if (loading) {
    return (
      <div className="room-list-page">
        <div className="empty-state">
          <p>読み込み中...</p>
        </div>
      </div>
    );
  }

  /** 表示名から名前部分を取得（姓名分離：劉 双→双、斎藤 花子→花子） */
  const getDisplayInitials = (name: string | undefined): string => {
    // 名前がない場合は人型アイコンを表示
    if (!name) return '👤';
    // スペース（全角・半角）で分割して名前部分を取得
    const parts = name.trim().split(/[\s\u3000]+/);
    if (parts.length >= 2) {
      // 姓名がある場合は名前部分（最後の部分）を返す
      return parts[parts.length - 1];
    }
    // スペースがない場合は先頭の1〜2文字を返す
    const cjkRegex = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/;
    if (cjkRegex.test(name)) {
      return name.slice(0, 2);
    }
    // アルファベット等は頭文字を大文字で
    return name.charAt(0).toUpperCase();
  };

  return (
    <div className="room-list-page">
      <header>
        <h1>🌐 LAMS 会議室</h1>
        <div className="user-info">
          <span className="user-avatar">{getDisplayInitials(user?.displayName)}</span>
          <button onClick={handleLogout}>ログアウト</button>
        </div>
      </header>

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
            <label>参加者による音声モード切替を許可</label>
            <div
              className={`toggle-switch ${formState.allowModeSwitch ? 'active' : ''}`}
              onClick={() => setFormState((prev) => ({ ...prev, allowModeSwitch: !prev.allowModeSwitch }))}
            />
            <span>{formState.allowModeSwitch ? '許可' : '禁止'}</span>
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
            <p>🏢 会議室がありません</p>
            <p>「新規会議室作成」ボタンから作成してください</p>
          </div>
        ) : (
          rooms.map((room) => (
            <div
              key={room.id}
              className="room-card"
              onClick={() => navigate(`/room/${room.id}`)}
            >
              <h3>{room.name}</h3>
              <p>{room.description || '会議概要なし'}</p>
              <div className="room-meta">
                <span className="participant-count">
                  {room.participantCount}
                </span>
                <div className="languages">
                  {(room.allowedLanguages ?? []).slice(0, 3).map((lang) => (
                    <span key={lang} className="language-tag">
                      {LANGUAGE_NAMES[lang as SupportedLanguage] ?? lang}
                    </span>
                  ))}
                  {(room.allowedLanguages?.length ?? 0) > 3 && (
                    <span className="language-tag">+{room.allowedLanguages.length - 3}</span>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
