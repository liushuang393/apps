/**
 * AI パイプライン設定 API の型とマッピング。
 * client.ts から分離し、ファイルサイズと責務を抑える。
 */

/** AI パイプライン設定フィールド（camelCase） */
export interface PipelineSettingsFields {
  aiProvider: string;
  asrProvider: string;
  mtProvider: string;
  ttsProvider: string;
  defaultMode: string;
  enablePartialSubtitles: boolean;
  llmCorrectionEnabled: boolean;
}

/** AI パイプライン設定レスポンス */
export interface PipelineSettingsResponse {
  effective: PipelineSettingsFields;
  envDefaults: PipelineSettingsFields;
  options: {
    aiProvider: string[];
    asrProvider: string[];
    mtProvider: string[];
    ttsProvider: string[];
    defaultMode: string[];
  };
  revision: number;
  warnings: string[];
}

interface PipelineSettingsFieldsApi {
  ai_provider: string;
  asr_provider: string;
  mt_provider: string;
  tts_provider: string;
  default_mode: string;
  enable_partial_subtitles: boolean;
  llm_correction_enabled: boolean;
}

export interface PipelineSettingsApiResponse {
  effective: PipelineSettingsFieldsApi;
  env_defaults: PipelineSettingsFieldsApi;
  options: {
    ai_provider: string[];
    asr_provider: string[];
    mt_provider: string[];
    tts_provider: string[];
    default_mode: string[];
  };
  revision: number;
  warnings: string[];
}

export function mapPipelineFields(
  fields: PipelineSettingsFieldsApi
): PipelineSettingsFields {
  return {
    aiProvider: fields.ai_provider,
    asrProvider: fields.asr_provider,
    mtProvider: fields.mt_provider,
    ttsProvider: fields.tts_provider,
    defaultMode: fields.default_mode,
    enablePartialSubtitles: Boolean(fields.enable_partial_subtitles),
    llmCorrectionEnabled: Boolean(fields.llm_correction_enabled),
  };
}

export function mapPipelineSettings(
  res: PipelineSettingsApiResponse
): PipelineSettingsResponse {
  return {
    effective: mapPipelineFields(res.effective),
    envDefaults: mapPipelineFields(res.env_defaults),
    options: {
      aiProvider: res.options.ai_provider,
      asrProvider: res.options.asr_provider,
      mtProvider: res.options.mt_provider,
      ttsProvider: res.options.tts_provider,
      defaultMode: res.options.default_mode,
    },
    revision: res.revision,
    warnings: res.warnings,
  };
}

/** PUT ボディ（snake_case）を組み立てる。 */
export function toPipelineSettingsPutBody(
  fields: Partial<PipelineSettingsFields>
): Record<string, string | boolean | undefined> {
  return {
    ai_provider: fields.aiProvider,
    asr_provider: fields.asrProvider,
    mt_provider: fields.mtProvider,
    tts_provider: fields.ttsProvider,
    default_mode: fields.defaultMode,
    enable_partial_subtitles: fields.enablePartialSubtitles,
    llm_correction_enabled: fields.llmCorrectionEnabled,
  };
}
