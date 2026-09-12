import {
  LIVE_EVENT_CONTRACT,
  LIVE_EVENT_SCHEMA_VERSION,
  type LiveEvent,
  type SubtitleEvent,
} from './liveEvent.generated.ts';

type FieldKind = 'string' | 'nullable_string' | 'integer' | 'number' | 'boolean';
type FieldRules = Readonly<Record<string, FieldKind>>;

interface EventDefinition {
  readonly required: FieldRules;
  readonly optional: FieldRules;
  readonly forbidden: readonly string[];
}

/** unknown値がJSON objectとして検証可能か判定する。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** canonical schemaのプリミティブ型へ値が適合するか判定する。 */
function matchesKind(value: unknown, kind: FieldKind): boolean {
  if (kind === 'string') return typeof value === 'string';
  if (kind === 'nullable_string') return value === null || typeof value === 'string';
  if (kind === 'boolean') return typeof value === 'boolean';
  if (kind === 'integer') return typeof value === 'number' && Number.isInteger(value);
  return typeof value === 'number' && Number.isFinite(value);
}

/** 必須または任意フィールド群をcanonical schemaに従って検証する。 */
function hasValidFields(
  value: Record<string, unknown>,
  fields: FieldRules,
  required: boolean
): boolean {
  return Object.entries(fields).every(([field, kind]) => {
    if (!(field in value)) return !required;
    return matchesKind(value[field], kind);
  });
}

/** schema versionなしの旧確定字幕だけをversion 1型へ限定的に正規化する。 */
function decodeLegacySubtitle(value: Record<string, unknown>): SubtitleEvent | null {
  if (
    value.type !== 'subtitle'
    || typeof value.id !== 'string'
    || typeof value.seq !== 'number'
    || !Number.isInteger(value.seq)
    || typeof value.speaker_id !== 'string'
    || typeof value.original_text !== 'string'
    || typeof value.source_language !== 'string'
    || value.is_final !== true
  ) {
    return null;
  }
  return {
    ...value,
    schema_version: LIVE_EVENT_SCHEMA_VERSION,
    type: 'subtitle',
    event_id: `legacy:${value.id}`,
    timestamp_ms: 0,
    room_id: '',
    utterance_id: value.id,
    generation_id: 0,
    sequence_id: value.seq,
    revision: 0,
    runtime: 'legacy',
    trace_id: `legacy:${value.id}`,
    id: value.id,
    seq: value.seq,
    speaker_id: value.speaker_id,
    original_text: value.original_text,
    source_language: value.source_language,
    is_final: true,
  };
}

/**
 * DataChannel境界でunknown payloadを一度だけ検証する。
 * 未知version・type・欠損・不正型は例外化せずnullとして無視する。
 */
export function decodeLiveEvent(value: unknown): LiveEvent | null {
  if (!isRecord(value)) return null;
  if (value.schema_version === undefined) return decodeLegacySubtitle(value);
  if (value.schema_version !== LIVE_EVENT_SCHEMA_VERSION || typeof value.type !== 'string') {
    return null;
  }

  const eventDefinitions: Readonly<Record<string, EventDefinition>> =
    LIVE_EVENT_CONTRACT.events;
  const definition = eventDefinitions[value.type];
  if (definition === undefined) return null;
  if (!hasValidFields(value, LIVE_EVENT_CONTRACT.common, true)) return null;
  if (!hasValidFields(value, definition.required, true)) return null;
  if (!hasValidFields(value, definition.optional, false)) return null;
  if (definition.forbidden.some((field) => field in value)) return null;
  return value as unknown as LiveEvent;
}
