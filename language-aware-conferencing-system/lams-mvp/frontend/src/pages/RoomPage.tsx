/**
 * 会議室ページ
 * リアルタイム音声会議と字幕表示
 */
import { useParams, useNavigate } from 'react-router-dom';
import { useWebSocket } from '../hooks/useWebSocket';
import { useRoomStore } from '../store/roomStore';
import { PreferencePanel } from '../components/PreferencePanel';
import { SubtitleDisplay } from '../components/SubtitleDisplay';
import { ParticipantList } from '../components/ParticipantList';

export function RoomPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const { isConnected, roomName, policy } = useRoomStore();
  const { sendPreferenceChange, disconnect } = useWebSocket(roomId || null);

  /** 退出処理 */
  const handleLeave = () => {
    disconnect();
    navigate('/rooms');
  };

  if (!roomId) {
    return (
      <div className="room-page">
        <div className="empty-state">
          <p>会議室IDが指定されていません</p>
        </div>
      </div>
    );
  }

  return (
    <div className="room-page">
      <header>
        <h1>🎤 {roomName || '会議室'}</h1>
        <div className="connection-status">
          {isConnected ? (
            <span className="connected">接続中</span>
          ) : (
            <span className="disconnected">接続中...</span>
          )}
        </div>
        <button onClick={handleLeave}>退室</button>
      </header>

      <div className="room-content">
        <aside className="sidebar">
          <ParticipantList />
          <PreferencePanel
            onPreferenceChange={sendPreferenceChange}
            policy={policy}
          />
        </aside>

        <main className="main-area">
          <div className="audio-area">
            <p>🎧 音声会議エリア</p>
            {/* WebRTC音声は別途実装 */}
          </div>
          <SubtitleDisplay />
        </main>
      </div>
    </div>
  );
}
