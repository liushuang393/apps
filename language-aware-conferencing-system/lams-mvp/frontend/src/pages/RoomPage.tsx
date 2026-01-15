/**
 * 会議室ページ
 * リアルタイム音声会議と字幕表示
 */
import { useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useWebSocket } from '../hooks/useWebSocket';
import { useAudioDevices } from '../hooks/useAudioDevices';
import { useAudioCapture } from '../hooks/useAudioCapture';
import { useRoomStore } from '../store/roomStore';
import { PreferencePanel } from '../components/PreferencePanel';
import { SubtitleDisplay } from '../components/SubtitleDisplay';
import { ParticipantList } from '../components/ParticipantList';

export function RoomPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const { connectionStatus, roomName, policy } = useRoomStore();
  const { sendPreferenceChange, disconnect, wsRef } = useWebSocket(roomId || null);

  // 音声デバイス管理
  const {
    microphones,
    speakers,
    selectedMicId,
    selectedSpeakerId,
    selectMicrophone,
    selectSpeaker,
    error: deviceError,
  } = useAudioDevices();

  // 音声キャプチャ（wsRefを渡して音声送信を有効化）
  const {
    isMicOn,
    toggleMic,
    volumeLevel,
    waveformData,
    isSpeaking,
    error: captureError,
  } = useAudioCapture({
    deviceId: selectedMicId,
    enabled: false, // 手動でON/OFFする
    wsRef,  // WebSocket経由で音声データを送信
  });

  // メインエリア波形Canvas
  const mainWaveformRef = useRef<HTMLCanvasElement>(null);

  // メインエリア波形描画
  useEffect(() => {
    const canvas = mainWaveformRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // 背景クリア
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, width, height);

    if (!isMicOn) {
      ctx.fillStyle = '#333';
      ctx.fillRect(0, height / 2 - 1, width, 2);
      return;
    }

    // 波形描画
    const barCount = waveformData.length;
    const barWidth = width / barCount;
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, isSpeaking ? '#00ff88' : '#4a90d9');
    gradient.addColorStop(1, isSpeaking ? '#00aa55' : '#2d5a87');
    ctx.fillStyle = gradient;

    for (let i = 0; i < barCount; i++) {
      const barHeight = (waveformData[i] / 255) * height;
      const x = i * barWidth;
      const y = (height - barHeight) / 2;
      ctx.fillRect(x, y, barWidth - 1, barHeight);
    }
  }, [waveformData, isMicOn, isSpeaking]);

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
        <div className="header-right">
          <div className="connection-status">
            {connectionStatus === 'connected' && (
              <span className="connected">接続中</span>
            )}
            {connectionStatus === 'connecting' && (
              <span className="connecting">接続中...</span>
            )}
            {connectionStatus === 'reconnecting' && (
              <span className="reconnecting">再接続中...</span>
            )}
            {connectionStatus === 'disconnected' && (
              <span className="disconnected">未接続</span>
            )}
          </div>
          {/* デバイス選択（コンパクト） */}
          <div className="header-devices">
            <div className="device-select" title="マイク選択">
              <span className="device-icon">🎤</span>
              <select
                value={selectedMicId || ''}
                onChange={(e) => selectMicrophone(e.target.value)}
                disabled={microphones.length === 0}
              >
                {microphones.map((mic) => (
                  <option key={mic.deviceId} value={mic.deviceId}>
                    {mic.label.length > 20 ? mic.label.slice(0, 20) + '…' : mic.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="device-select" title="スピーカー選択">
              <span className="device-icon">🔊</span>
              <select
                value={selectedSpeakerId || ''}
                onChange={(e) => selectSpeaker(e.target.value)}
                disabled={speakers.length === 0}
              >
                {speakers.map((spk) => (
                  <option key={spk.deviceId} value={spk.deviceId}>
                    {spk.label.length > 20 ? spk.label.slice(0, 20) + '…' : spk.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <button className="leave-btn" onClick={handleLeave}>退室</button>
        </div>
      </header>

      <div className="room-content">
        <aside className="sidebar">
          <ParticipantList />
          <PreferencePanel
            onPreferenceChange={sendPreferenceChange}
            policy={policy}
            audioProps={{
              isMicOn,
              onMicToggle: toggleMic,
              volumeLevel,
              isSpeaking,
              error: deviceError || captureError,
            }}
          />
        </aside>

        <main className="main-area">
          {/* 字幕表示エリア（上部・大きく） */}
          <SubtitleDisplay />

          {/* 音声状態エリア（下部・コンパクト） */}
          <div className="audio-status-bar">
            {isMicOn ? (
              <div className="audio-active-compact">
                <span className="mic-status on">
                  {isSpeaking ? '🎤 発話中' : '🎤 待機中'}
                </span>
                <div className="volume-bar-compact">
                  <div
                    className="volume-fill"
                    style={{ width: `${volumeLevel}%` }}
                  />
                </div>
                <span className="volume-text">{volumeLevel}%</span>
                {/* コンパクト波形 */}
                <canvas ref={mainWaveformRef} width={200} height={30} className="waveform-compact" />
              </div>
            ) : (
              <div className="audio-inactive-compact">
                <span className="mic-status off">🔇 マイクOFF</span>
                <span className="hint-compact">左側の設定パネルでマイクをONにできます</span>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
