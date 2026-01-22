/**
 * 字幕表示コンポーネント
 * リアルタイム字幕と翻訳結果を表示
 * 自分の発言も含めて「発言者名：発言内容」形式で表示
 */
import { useEffect, useRef } from 'react';
import { useRoomStore } from '../store/roomStore';
import { useAuthStore } from '../store/authStore';

export function SubtitleDisplay() {
  const { subtitles, myPreference, participants } = useRoomStore();
  const currentUserId = useAuthStore((s) => s.user?.id);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 新しい字幕が追加されたら自動スクロール
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [subtitles]);

  // 字幕無効の場合は最小表示
  if (!myPreference?.subtitleEnabled) {
    return (
      <div className="subtitle-display" style={{ opacity: 0.5 }}>
        <h4>📝 字幕</h4>
        <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.9rem' }}>
          字幕表示はオフです
        </p>
      </div>
    );
  }

  return (
    <div className="subtitle-display" ref={scrollRef}>
      <h4>📝 字幕・会議記録</h4>
      {subtitles.length === 0 ? (
        <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.9rem' }}>
          発言を待っています...
        </p>
      ) : (
        subtitles.map((sub, idx) => {
          const speaker = participants.get(sub.speakerId);
          const isMyMessage = sub.speakerId === currentUserId;
          const displayName = speaker?.displayName || '不明';
          // 字幕のユニークキー（speakerId + index + text hash）
          const subtitleKey = `${sub.speakerId}-${idx}-${sub.text.slice(0, 10)}`;

          return (
            <div
              key={subtitleKey}
              className={`subtitle-item ${isMyMessage ? 'my-message' : ''}`}
            >
              <span className="speaker-name">
                {displayName}
                {isMyMessage && ' (自分)'}：
              </span>
              <span className="subtitle-text">{sub.text}</span>
              {sub.isTranslated && (
                <span className="translated-badge">翻訳</span>
              )}
              {sub.latencyMs && sub.latencyMs > 0 && (
                <span className="latency-badge" title="翻訳遅延">
                  {sub.latencyMs}ms
                </span>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
