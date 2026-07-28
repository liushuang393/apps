/**
 * 自動生成ファイル。直接編集しないこと。
 * 生成元: backend/app/ai_pipeline/event_contract.py
 */
export const LIVE_EVENT_SCHEMA_VERSION = 1 as const;

export const LIVE_EVENT_CONTRACT = {"schema_version":1,"common":{"schema_version":"integer","type":"string","event_id":"string","timestamp_ms":"integer","room_id":"string","speaker_id":"string","utterance_id":"string","generation_id":"integer","sequence_id":"integer","revision":"integer","runtime":"string","trace_id":"string"},"events":{"subtitle":{"required":{"id":"string","seq":"integer","original_text":"string","source_language":"string","is_final":"boolean"},"optional":{"translated_text":"nullable_string","target_language":"string","is_translated":"boolean","is_partial":"boolean","degraded":"boolean","mainline":"string","provider":"nullable_string","model_id":"nullable_string","speaker_label":"nullable_string"},"forbidden":[]},"subtitle_interim":{"required":{"id":"string","seq":"integer","text":"string","is_final":"boolean"},"optional":{},"forbidden":[]},"qos_warning":{"required":{"metric":"string","should_fallback_to_subtitle":"boolean"},"optional":{"mainline":"string","value":"number","value_ms":"number","target":"number","target_ms":"number"},"forbidden":["original_text","translated_text","text","token","authorization","api_key","openai_api_key","deepgram_api_key"]},"qoe_degraded":{"required":{"metric":"string","mainline":"string","should_fallback_to_subtitle":"boolean"},"optional":{"reason_code":"string","ui_reason":"string"},"forbidden":["original_text","translated_text","text","token","authorization","api_key","openai_api_key","deepgram_api_key"]},"qoe_recovered":{"required":{"metric":"string","mainline":"string","should_fallback_to_subtitle":"boolean"},"optional":{},"forbidden":["original_text","translated_text","text","token","authorization","api_key","openai_api_key","deepgram_api_key"]},"overload_degraded":{"required":{"metric":"string","mainline":"string","should_fallback_to_subtitle":"boolean"},"optional":{"reason_code":"string","ui_reason":"string"},"forbidden":["original_text","translated_text","text","token","authorization","api_key","openai_api_key","deepgram_api_key"]},"translation_interrupted":{"required":{"mainline":"string"},"optional":{},"forbidden":["original_text","translated_text","text","token","authorization","api_key","openai_api_key","deepgram_api_key"]}}} as const;

export type LiveEventType = keyof typeof LIVE_EVENT_CONTRACT.events;

export interface LiveEventEnvelope {
  schema_version: typeof LIVE_EVENT_SCHEMA_VERSION;
  type: LiveEventType;
  event_id: string;
  timestamp_ms: number;
  room_id: string;
  speaker_id: string;
  utterance_id: string;
  generation_id: number;
  sequence_id: number;
  revision: number;
  runtime: string;
  trace_id: string;
}

export interface SubtitleEvent extends LiveEventEnvelope {
  type: 'subtitle';
  id: string;
  seq: number;
  original_text: string;
  source_language: string;
  is_final: boolean;
  translated_text?: string | null;
  target_language?: string;
  is_translated?: boolean;
  is_partial?: boolean;
  degraded?: boolean;
  mainline?: string;
  provider?: string | null;
  model_id?: string | null;
  speaker_label?: string | null;
}

export interface SubtitleInterimEvent extends LiveEventEnvelope {
  type: 'subtitle_interim';
  id: string;
  seq: number;
  text: string;
  is_final: boolean;
}

export interface QosWarningEvent extends LiveEventEnvelope {
  type: 'qos_warning';
  metric: string;
  should_fallback_to_subtitle: boolean;
  mainline?: string;
  value?: number;
  value_ms?: number;
  target?: number;
  target_ms?: number;
}

export interface QoeDegradedEvent extends LiveEventEnvelope {
  type: 'qoe_degraded';
  metric: string;
  mainline: string;
  should_fallback_to_subtitle: boolean;
  reason_code?: string;
  ui_reason?: string;
}

export interface QoeRecoveredEvent extends LiveEventEnvelope {
  type: 'qoe_recovered';
  metric: string;
  mainline: string;
  should_fallback_to_subtitle: boolean;
}

export interface OverloadDegradedEvent extends LiveEventEnvelope {
  type: 'overload_degraded';
  metric: string;
  mainline: string;
  should_fallback_to_subtitle: boolean;
  reason_code?: string;
  ui_reason?: string;
}

export interface TranslationInterruptedEvent extends LiveEventEnvelope {
  type: 'translation_interrupted';
  mainline: string;
}

export type LiveEvent =
  | SubtitleEvent
  | SubtitleInterimEvent
  | QosWarningEvent
  | QoeDegradedEvent
  | QoeRecoveredEvent
  | OverloadDegradedEvent
  | TranslationInterruptedEvent;
