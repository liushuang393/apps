/**
 * 会議室ページ
 * リアルタイム音声会議と字幕表示
 */
import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useLiveKit } from '../hooks/useLiveKit';
import { useAudioDevices } from '../hooks/useAudioDevices';
import { useAudioCapture } from '../hooks/useAudioCapture';
import { useRoomStore } from '../store/roomStore';
import { useAuthStore } from '../store/authStore';
import { roomApi } from '../api/client';
import { PreferencePanel } from '../components/PreferencePanel';
import { MeetingModePanel } from '../components/MeetingModePanel';
import { SubtitleDisplay } from '../components/SubtitleDisplay';
import { ParticipantList } from '../components/ParticipantList';
import type { MeetingMode, Room, RoomMediaState } from '../types';
import '../styles/pages/room.css';

/** 品質警告の i18n キーを返す（表示側で t() に通す） */
function qualityWarningKey(
  mediaState: RoomMediaState,
  shouldFallbackToSubtitle: boolean
): string {
  if (mediaState === 'interrupted') {
    return 'room.warningInterrupted';
  }
  if (mediaState === 'degraded' || shouldFallbackToSubtitle) {
    return 'room.warningDegraded';
  }
  return 'room.warningGeneric';
}

export function RoomPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { t } = useTranslation();
  const [roomMeta, setRoomMeta] = useState<Room | null>(null);
  const {
    connectionStatus,
    connectionError,
    qosWarnings,
    mediaState,
    roomName,
    policy,
  } = useRoomStore();
  const {
    sendPreferenceChange,
    disconnect,
    roomRef,
    setAudioOutputDevice,
    audioOutputSelectionSupported,
  } = useLiveKit(roomId || null);

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

  // 音声キャプチャ（roomRef を渡して mic track を LiveKit へ publish）
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
    roomRef, // LiveKit Room 経由で mic track を publish
  });

  // メインエリア波形Canvas
  const mainWaveformRef = useRef<HTMLCanvasElement>(null);

  // 部屋メタ（作成者・既定主線）を取得し、会議主線切替 UI に渡す
  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const room = await roomApi.get(roomId);
        if (!cancelled) setRoomMeta(room);
      } catch {
        if (!cancelled) setRoomMeta(null);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  useEffect(() => {
    if (!selectedSpeakerId) return;
    void setAudioOutputDevice(selectedSpeakerId);
  }, [selectedSpeakerId, setAudioOutputDevice]);

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
      <div className="room-page" data-testid="room-page">
        <div className="empty-state">
          <p>{t('room.noRoomId')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="room-page" data-testid="room-page">
      {/* E2E: room-page / connection-status / leave-btn（preference-panel / subtitle-display は子） */}
      <header>
        {/* LiveKit 未接続時も API メタの部屋名を表示する */}
        <h1>🎤 {roomMeta?.name || roomName || t('room.fallbackName')}</h1>
        <div className="header-right">
          <div className="connection-status" data-testid="connection-status">
            {connectionStatus === 'connected' && (
              <span className="connected">{t('room.statusConnected')}</span>
            )}
            {connectionStatus === 'connecting' && (
              <span className="connecting">{t('meeting.connecting')}</span>
            )}
            {connectionStatus === 'reconnecting' && (
              <span className="reconnecting">{t('meeting.reconnecting')}</span>
            )}
            {connectionStatus === 'disconnected' && (
              <span className="disconnected">{t('room.statusDisconnected')}</span>
            )}
          </div>
          {/* デバイス選択（コンパクト） */}
          <div className="header-devices">
            <div className="device-select" title={t('room.micSelect')}>
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
            <div className="device-select" title={t('room.speakerSelect')}>
              <span className="device-icon">🔊</span>
              <select
                value={selectedSpeakerId || ''}
                onChange={(e) => selectSpeaker(e.target.value)}
                disabled={speakers.length === 0 || !audioOutputSelectionSupported}
              >
                {speakers.map((spk) => (
                  <option key={spk.deviceId} value={spk.deviceId}>
                    {spk.label.length > 20 ? spk.label.slice(0, 20) + '…' : spk.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <button
            className="transcript-btn"
            onClick={() => navigate(`/room/${roomId}/transcript`)}
            title={t('room.transcriptTitle')}
          >
            {t('room.transcriptButton')}
          </button>
          <button
            className="leave-btn"
            onClick={handleLeave}
            data-testid="leave-btn"
          >
            {t('room.leave')}
          </button>
        </div>
      </header>

      {connectionError && (
        <div className="error" role="alert">
          {connectionError}
        </div>
      )}
      {(qosWarnings.length > 0 || mediaState !== 'healthy') && (
        <div className="warning" role="status">
          {t(qualityWarningKey(
            mediaState,
            Boolean(qosWarnings[qosWarnings.length - 1]?.shouldFallbackToSubtitle)
          ))}
        </div>
      )}
      {!audioOutputSelectionSupported && (
        <div className="hint-text">
          {t('room.speakerUnsupported')}
        </div>
      )}

      <div className="room-content">
        <aside className="sidebar">
          <ParticipantList />
          {roomId && roomMeta && (
            <MeetingModePanel
              roomId={roomId}
              creatorId={roomMeta.creatorId}
              user={user}
              roomDefaultMode={(roomMeta.defaultMode || 'hybrid') as MeetingMode}
            />
          )}
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
                  {isSpeaking ? t('room.micSpeaking') : t('room.micIdle')}
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
                <span className="mic-status off">{t('room.micOff')}</span>
                <span className="hint-compact">{t('room.micOffHint')}</span>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
