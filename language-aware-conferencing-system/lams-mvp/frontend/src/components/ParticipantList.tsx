/**
 * 参加者一覧コンポーネント
 * 現在の参加者とマイク状態を表示（折りたたみ機能付き）
 *
 * 表示ルール:
 * - 自分を一番上に表示、他の参加者は名前順（昇順）
 * - マイクON: 🎤 アイコンを表示（ユーザーがマイクをONにしている）
 * - 発話中: speaking クラスでハイライト（activeSpeaker と一致）
 *
 * ★パフォーマンス最適化★
 * - Zustand セレクターで必要な状態のみ購読
 * - React.memo でコンポーネントをメモ化
 */
import { useMemo, useState, memo, useCallback } from 'react';
import { useAuthStore } from '../store/authStore';
import { useRoomStore } from '../store/roomStore';

/** 言語コード表示名 */
const LANGUAGE_CODES: Record<string, string> = {
  ja: 'JP',
  en: 'EN',
  zh: 'CN',
  vi: 'VN',
};

/**
 * ★パフォーマンス最適化: Zustand セレクター★
 */
const selectParticipants = (s: ReturnType<typeof useRoomStore.getState>) => s.participants;
const selectActiveSpeaker = (s: ReturnType<typeof useRoomStore.getState>) => s.activeSpeaker;

function ParticipantListInner() {
  // ★パフォーマンス最適化: 個別セレクターで購読★
  const participants = useRoomStore(selectParticipants);
  const activeSpeaker = useRoomStore(selectActiveSpeaker);
  const currentUserId = useAuthStore((s) => s.user?.id);
  const [isExpanded, setIsExpanded] = useState(true);

  // ★パフォーマンス最適化: トグル関数をメモ化★
  const toggleExpanded = useCallback(() => setIsExpanded((prev) => !prev), []);

  // ★参加者ソート: 自分が最上、他は名前順（昇順）★
  const sortedParticipants = useMemo(() => {
    return Array.from(participants.values()).sort((a, b) => {
      // 自分は常に最上
      if (a.userId === currentUserId) return -1;
      if (b.userId === currentUserId) return 1;
      // 他は名前順（昇順）
      return a.displayName.localeCompare(b.displayName, 'ja');
    });
  }, [participants, currentUserId]);

  return (
    <div className={`participant-list collapsible-panel ${isExpanded ? 'expanded' : 'collapsed'}`}>
      <button
        className="panel-header"
        onClick={toggleExpanded}
        aria-expanded={isExpanded}
      >
        <span className="panel-title">
          <span className="panel-icon">👥</span>
          参加者 ({participants.size})
        </span>
        <span className={`chevron ${isExpanded ? 'up' : 'down'}`}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path
              d="M2 4L6 8L10 4"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>
      <div className="panel-content">
        {participants.size === 0 ? (
          <p className="empty-message">参加者がいません</p>
        ) : (
          <ul>
            {sortedParticipants.map((p) => {
              const isMe = p.userId === currentUserId;
              return (
                <li
                  key={p.userId}
                  className={`${activeSpeaker === p.userId ? 'speaking' : ''} ${isMe ? 'is-me' : ''}`}
                >
                  <span className="name">
                    {p.displayName}（{LANGUAGE_CODES[p.nativeLanguage] ?? 'XX'}）
                    {isMe && ' (自分)'}
                  </span>
                  {/* マイクON状態を表示（ユーザーがマイクをONにしている場合） */}
                  {p.isMicOn && (
                    <span className="mic-indicator" title="マイクON">🎤</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * ★パフォーマンス最適化: React.memo でメモ化★
 */
export const ParticipantList = memo(ParticipantListInner);
