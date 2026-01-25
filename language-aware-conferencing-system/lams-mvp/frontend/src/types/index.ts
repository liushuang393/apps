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
  /** マイクがONかどうか */
  isMicOn?: boolean;
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

/** 字幕データ（クライアント側翻訳対応） */
export interface SubtitleData {
  /** 字幕の一意識別子（重複排除用） */
  id?: string;
  /** シーケンス番号（順序保証用） */
  seq?: number;
  /** 話者ID */
  speakerId: string;
  /** 原文テキスト */
  originalText: string;
  /** 原文の言語 */
  sourceLanguage: SupportedLanguage;
  /** 翻訳後テキスト（クライアント側で翻訳した場合） */
  translatedText?: string;
  /** ★サーバー側プリ翻訳結果（言語コード → 翻訳テキスト） */
  translations?: Record<string, string>;
  /** 翻訳済みフラグ */
  isTranslated?: boolean;
  /** 翻訳遅延（ms） */
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
  | 'mic_status_changed'
  | 'subtitle'
  | 'subtitle_interim'  // ★ストリーミング字幕（認識中）
  | 'qos_warning'
  | 'error';

/** ★暫定字幕データ（ストリーミングASR用） */
export interface InterimSubtitleData {
  /** 字幕の一意識別子 */
  id: string;
  /** 話者ID */
  speakerId: string;
  /** 認識中テキスト */
  text: string;
  /** 最終確定かどうか */
  isFinal: boolean;
}
