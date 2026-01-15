/**
 * LAMS フロントエンド型定義
 */

/** 対応言語 */
export type SupportedLanguage = 'ja' | 'en' | 'zh' | 'vi';

/** 音声モード: 原声 or 翻訳 */
export type AudioMode = 'original' | 'translated';

/** ユーザーロール */
export type UserRole = 'admin' | 'moderator' | 'user';

/** ユーザー情報 */
export interface User {
  id: string;
  email: string;
  displayName: string;
  nativeLanguage: SupportedLanguage;
  role: UserRole;
  isActive: boolean;
}

/** 参加者設定 */
export interface ParticipantPreference {
  userId: string;
  displayName: string;
  nativeLanguage: SupportedLanguage;
  audioMode: AudioMode;
  subtitleEnabled: boolean;
  targetLanguage: SupportedLanguage;
}

/** 会議室ポリシー */
export interface RoomPolicy {
  allowedLanguages: SupportedLanguage[];
  defaultAudioMode: AudioMode;
  allowModeSwitch: boolean;
}

/** 会議室情報 */
export interface Room {
  id: string;
  name: string;
  description: string | null;
  creatorId: string;
  allowedLanguages: SupportedLanguage[];
  defaultAudioMode: AudioMode;
  allowModeSwitch: boolean;
  isPrivate: boolean;  // 私有会議（作成者以外は一覧に非表示・入室不可）
  isActive: boolean;
  participantCount: number;
}

/** 字幕データ */
export interface SubtitleData {
  speakerId: string;
  text: string;
  language: SupportedLanguage;
  isTranslated: boolean;
  latencyMs?: number;
}

/** WebSocketメッセージ型 */
export type WSMessageType =
  | 'room_state'
  | 'user_joined'
  | 'user_left'
  | 'preference_updated'
  | 'user_preference_changed'
  | 'speaking_start'
  | 'speaking_end'
  | 'subtitle'
  | 'qos_warning'
  | 'error';
