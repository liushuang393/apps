/**
 * APIクライアント（バレル）
 *
 * 実装はドメイン別モジュール（http / auth / rooms / admin / glossary / meetings）にある。
 * 既存の `import ... from '../api/client'` を変えないため、公開名のみ再エクスポートする。
 * 注意: 内部用の apiFetch は従来どおり公開しない。
 */
export { ApiError } from './http';
export { translatePipelineWarning } from './apiErrorText';
export { authApi } from './auth';
export type { ParticipationHistory } from './auth';
export { roomApi } from './rooms';
export type { SubtitleRecord, TranscriptData, SessionSummary, JoinToken, MinutesData } from './rooms';
export { adminApi } from './admin';
export type {
  AdminUser,
  SystemStats,
  ExperimentVariantInfo,
  ExperimentInfo,
  MetricStat,
  ExperimentSummary,
  RerunSummary,
  LanguageOption,
  LanguageSettings,
} from './admin';
export { glossaryApi } from './glossary';
export type { GlossaryTerm, GlossaryTermInput } from './glossary';
export { meetingsApi } from './meetings';

export type { PipelineSettingsFields, PipelineSettingsResponse } from './pipelineSettings';
