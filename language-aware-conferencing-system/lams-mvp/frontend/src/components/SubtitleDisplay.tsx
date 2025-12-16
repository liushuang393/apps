/**
 * 字幕表示コンポーネント
 * リアルタイム字幕と翻訳結果を表示
 */
import { useRoomStore } from '../store/roomStore';

export function SubtitleDisplay() {
  const { subtitles, myPreference, participants } = useRoomStore();

  // 字幕無効の場合は最小表示
  if (!myPreference?.subtitleEnabled) {
    return (
      <div className="subtitle-display" style={{ opacity: 0.5 }}>
        <h4>字幕</h4>
        <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.9rem' }}>
          字幕表示はオフです
        </p>
      </div>
    );
  }

  return (
    <div className="subtitle-display">
      <h4>字幕</h4>
      {subtitles.length === 0 ? (
        <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.9rem' }}>
          発言を待っています...
        </p>
      ) : (
        subtitles.map((sub, idx) => {
          const speaker = participants.get(sub.speakerId);
          return (
            <div key={idx} className="subtitle-item">
              <span className="speaker-name">
                {speaker?.displayName || '不明'}:
              </span>
              <span className="subtitle-text">{sub.text}</span>
              {sub.isTranslated && (
                <span className="translated-badge">翻訳</span>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
