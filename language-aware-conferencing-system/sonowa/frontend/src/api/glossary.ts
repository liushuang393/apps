/**
 * 用語集 API（管理者専用 CRUD）
 *
 * 公開名は client.ts 経由で再エクスポートされる。
 */
import { apiFetch } from './http';

/** 用語集用語（camelCase） */
export interface GlossaryTerm {
  id: string;
  sourceLanguage: string;
  targetLanguage: string;
  sourceTerm: string;
  targetTerm: string | null;
  termType: string;
  priority: number;
  doNotTranslate: boolean;
  enabled: boolean;
}

interface GlossaryTermApiResponse {
  id: string;
  source_language: string;
  target_language: string;
  source_term: string;
  target_term: string | null;
  term_type: string;
  priority: number;
  do_not_translate: boolean;
  enabled: boolean;
}

function convertGlossaryTerm(t: GlossaryTermApiResponse): GlossaryTerm {
  return {
    id: t.id,
    sourceLanguage: t.source_language,
    targetLanguage: t.target_language,
    sourceTerm: t.source_term,
    targetTerm: t.target_term,
    termType: t.term_type,
    priority: t.priority,
    doNotTranslate: t.do_not_translate,
    enabled: t.enabled,
  };
}

export interface GlossaryTermInput {
  sourceLanguage: string;
  targetLanguage: string;
  sourceTerm: string;
  targetTerm?: string | null;
  termType?: string;
  priority?: number;
  doNotTranslate?: boolean;
  enabled?: boolean;
}

/** 用語集 CRUD（管理者専用） */
export const glossaryApi = {
  list: async (filters?: {
    sourceLanguage?: string;
    targetLanguage?: string;
    enabled?: boolean;
  }): Promise<GlossaryTerm[]> => {
    const params = new URLSearchParams();
    if (filters?.sourceLanguage) params.set('source_language', filters.sourceLanguage);
    if (filters?.targetLanguage) params.set('target_language', filters.targetLanguage);
    if (filters?.enabled !== undefined) params.set('enabled', String(filters.enabled));
    const query = params.toString() ? `?${params.toString()}` : '';
    const res = await apiFetch<GlossaryTermApiResponse[]>(`/glossaries/terms${query}`);
    return res.map(convertGlossaryTerm);
  },

  create: async (data: GlossaryTermInput): Promise<GlossaryTerm> => {
    const res = await apiFetch<GlossaryTermApiResponse>('/glossaries/terms', {
      method: 'POST',
      body: JSON.stringify({
        source_language: data.sourceLanguage,
        target_language: data.targetLanguage,
        source_term: data.sourceTerm,
        target_term: data.targetTerm,
        term_type: data.termType ?? 'general',
        priority: data.priority ?? 100,
        do_not_translate: data.doNotTranslate ?? false,
        enabled: data.enabled ?? true,
      }),
    });
    return convertGlossaryTerm(res);
  },

  update: async (termId: string, data: Partial<GlossaryTermInput>): Promise<GlossaryTerm> => {
    const res = await apiFetch<GlossaryTermApiResponse>(`/glossaries/terms/${termId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        source_language: data.sourceLanguage,
        target_language: data.targetLanguage,
        source_term: data.sourceTerm,
        target_term: data.targetTerm,
        term_type: data.termType,
        priority: data.priority,
        do_not_translate: data.doNotTranslate,
        enabled: data.enabled,
      }),
    });
    return convertGlossaryTerm(res);
  },

  delete: async (termId: string): Promise<void> => {
    await apiFetch<void>(`/glossaries/terms/${termId}`, { method: 'DELETE' });
  },
};
