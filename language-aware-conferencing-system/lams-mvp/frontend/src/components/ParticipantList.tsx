/**
 * 参加者一覧コンポーネント
 * 現在の参加者と発言状態を表示（折りたたみ機能付き）
 */
import { useState } from 'react';
import { useRoomStore } from '../store/roomStore';

/** 言語コード表示名 */
const LANGUAGE_CODES: Record<string, string> = {
  ja: 'JP',
  en: 'EN',
  zh: 'CN',
  vi: 'VN',
};

export function ParticipantList() {
  const { participants, activeSpeaker } = useRoomStore();
  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <div className={`participant-list collapsible-panel ${isExpanded ? 'expanded' : 'collapsed'}`}>
      <button
        className="panel-header"
        onClick={() => setIsExpanded(!isExpanded)}
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
            {Array.from(participants.values()).map((p) => (
              <li
                key={p.userId}
                className={activeSpeaker === p.userId ? 'speaking' : ''}
              >
                <span className="name">
                  {p.displayName}（{LANGUAGE_CODES[p.nativeLanguage] ?? 'XX'}）
                </span>
                {activeSpeaker === p.userId && (
                  <span className="speaking-indicator">🎤</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
