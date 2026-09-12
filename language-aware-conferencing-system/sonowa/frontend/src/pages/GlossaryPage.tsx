/**
 * 用語集管理ページ
 * 管理者向けの企業用語 CRUD。tenant_id は扱わない（グローバル用語のみ）。
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  adminApi,
  glossaryApi,
  ApiError,
  type GlossaryTerm,
  type GlossaryTermInput,
} from '../api/client';
import { useAuthStore } from '../store/authStore';
import { LANGUAGE_NAMES } from '../constants/languages';
import type { SupportedLanguage } from '../types';
import '../styles/pages/admin.css';
import '../styles/pages/glossary.css';

const TERM_TYPES = ['general', 'business', 'person', 'product'] as const;

interface TermDraft {
  sourceLanguage: string;
  targetLanguage: string;
  sourceTerm: string;
  targetTerm: string;
  termType: string;
  priority: number;
  doNotTranslate: boolean;
  enabled: boolean;
}

const EMPTY_DRAFT: TermDraft = {
  sourceLanguage: 'ja',
  targetLanguage: 'en',
  sourceTerm: '',
  targetTerm: '',
  termType: 'general',
  priority: 100,
  doNotTranslate: false,
  enabled: true,
};

function toDraft(term: GlossaryTerm): TermDraft {
  return {
    sourceLanguage: term.sourceLanguage,
    targetLanguage: term.targetLanguage,
    sourceTerm: term.sourceTerm,
    targetTerm: term.targetTerm ?? '',
    termType: term.termType,
    priority: term.priority,
    doNotTranslate: term.doNotTranslate,
    enabled: term.enabled,
  };
}

export function GlossaryPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, logout, hasHydrated } = useAuthStore();
  const [terms, setTerms] = useState<GlossaryTerm[]>([]);
  const [languages, setLanguages] = useState<string[]>(['ja', 'en', 'zh', 'vi']);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<TermDraft>(EMPTY_DRAFT);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [list, settings] = await Promise.all([
        glossaryApi.list(),
        adminApi.getLanguageSettings(),
      ]);
      setTerms(list);
      setLanguages(settings.enabledLanguages);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        logout();
        navigate('/login');
        return;
      }
      if (err instanceof ApiError && err.status === 403) {
        setError(t('glossary.adminRequired'));
        return;
      }
      setError(t('glossary.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [logout, navigate, t]);

  useEffect(() => {
    if (!hasHydrated) return;
    if (user?.role !== 'admin') {
      navigate('/menu');
      return;
    }
    void load();
  }, [hasHydrated, user, load, navigate]);

  const openCreate = () => {
    setEditingId(null);
    setDraft({
      ...EMPTY_DRAFT,
      sourceLanguage: languages[0] ?? 'ja',
      targetLanguage: languages[1] ?? languages[0] ?? 'en',
    });
    setModalOpen(true);
  };

  const openEdit = (term: GlossaryTerm) => {
    setEditingId(term.id);
    setDraft(toDraft(term));
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!draft.doNotTranslate && !draft.targetTerm.trim()) {
      setError(t('glossary.targetRequired'));
      return;
    }
    const payload: GlossaryTermInput = {
      sourceLanguage: draft.sourceLanguage,
      targetLanguage: draft.targetLanguage,
      sourceTerm: draft.sourceTerm.trim(),
      targetTerm: draft.doNotTranslate ? draft.targetTerm.trim() || null : draft.targetTerm.trim(),
      termType: draft.termType,
      priority: draft.priority,
      doNotTranslate: draft.doNotTranslate,
      enabled: draft.enabled,
    };
    try {
      setSaving(true);
      setError(null);
      if (editingId) {
        await glossaryApi.update(editingId, payload);
      } else {
        await glossaryApi.create(payload);
      }
      setModalOpen(false);
      await load();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        logout();
        navigate('/login');
        return;
      }
      setError(err instanceof ApiError ? err.message : t('glossary.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (term: GlossaryTerm) => {
    if (!window.confirm(t('glossary.deleteConfirm', { term: term.sourceTerm }))) {
      return;
    }
    try {
      await glossaryApi.delete(term.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('glossary.deleteFailed'));
    }
  };

  const langLabel = (code: string) =>
    LANGUAGE_NAMES[code as SupportedLanguage] || code;

  if (!hasHydrated || loading) {
    return (
      <div className="admin-page">
        <div className="empty-state">
          <p>{t('common.loading')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-page glossary-page" data-testid="glossary-page">
      <header>
        <div className="header-left">
          <button type="button" onClick={() => navigate('/admin')}>
            {t('common.back')}
          </button>
          <h1>📖 {t('glossary.title')}</h1>
        </div>
        <div className="header-right">
          <button
            type="button"
            className="glossary-add-btn"
            data-testid="glossary-add"
            onClick={openCreate}
          >
            {t('glossary.add')}
          </button>
        </div>
      </header>

      {error && <div className="error">{error}</div>}

      <section className="admin-users">
        <p className="glossary-hint">{t('glossary.description')}</p>
        {terms.length === 0 ? (
          <div className="empty-state">
            <p data-testid="glossary-empty">{t('glossary.empty')}</p>
          </div>
        ) : (
          <div className="users-table-wrapper">
            <table className="users-table">
              <thead>
                <tr>
                  <th>{t('glossary.pair')}</th>
                  <th>{t('glossary.sourceTerm')}</th>
                  <th>{t('glossary.targetTerm')}</th>
                  <th>{t('glossary.termType')}</th>
                  <th>{t('glossary.priority')}</th>
                  <th>{t('glossary.flags')}</th>
                  <th>{t('common.edit')}</th>
                </tr>
              </thead>
              <tbody>
                {terms.map((term) => (
                  <tr key={term.id} data-testid={`glossary-row-${term.id}`}>
                    <td>
                      {langLabel(term.sourceLanguage)} → {langLabel(term.targetLanguage)}
                    </td>
                    <td data-testid={`glossary-source-${term.id}`}>{term.sourceTerm}</td>
                    <td>{term.doNotTranslate ? '—' : term.targetTerm}</td>
                    <td>{t(`glossary.type.${term.termType}`)}</td>
                    <td>{term.priority}</td>
                    <td>
                      {term.doNotTranslate && (
                        <span className="status-badge inactive">{t('glossary.doNotTranslate')}</span>
                      )}
                      <span className={`status-badge ${term.enabled ? 'active' : 'inactive'}`}>
                        {term.enabled ? t('glossary.enabled') : t('glossary.disabled')}
                      </span>
                    </td>
                    <td>
                      <button type="button" className="edit-btn" onClick={() => openEdit(term)}>
                        {t('common.edit')}
                      </button>
                      <button
                        type="button"
                        className="edit-btn glossary-delete-btn"
                        onClick={() => void handleDelete(term)}
                      >
                        {t('common.delete')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {modalOpen && (
        <div className="modal-overlay" onClick={() => setModalOpen(false)}>
          <div className="modal-content glossary-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{editingId ? t('glossary.editTitle') : t('glossary.add')}</h3>
            <div className="form-group">
              <label>{t('glossary.sourceLanguage')}</label>
              <select
                value={draft.sourceLanguage}
                onChange={(e) => setDraft({ ...draft, sourceLanguage: e.target.value })}
              >
                {languages.map((lang) => (
                  <option key={lang} value={lang}>
                    {langLabel(lang)}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>{t('glossary.targetLanguage')}</label>
              <select
                value={draft.targetLanguage}
                onChange={(e) => setDraft({ ...draft, targetLanguage: e.target.value })}
              >
                {languages.map((lang) => (
                  <option key={lang} value={lang}>
                    {langLabel(lang)}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>{t('glossary.sourceTerm')}</label>
              <input
                data-testid="glossary-source-input"
                value={draft.sourceTerm}
                onChange={(e) => setDraft({ ...draft, sourceTerm: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>
                <input
                  type="checkbox"
                  checked={draft.doNotTranslate}
                  onChange={(e) =>
                    setDraft({ ...draft, doNotTranslate: e.target.checked })
                  }
                />
                {t('glossary.doNotTranslate')}
              </label>
            </div>
            {!draft.doNotTranslate && (
              <div className="form-group">
                <label>{t('glossary.targetTerm')}</label>
                <input
                  data-testid="glossary-target-input"
                  value={draft.targetTerm}
                  onChange={(e) => setDraft({ ...draft, targetTerm: e.target.value })}
                />
              </div>
            )}
            <div className="form-group">
              <label>{t('glossary.termType')}</label>
              <select
                value={draft.termType}
                onChange={(e) => setDraft({ ...draft, termType: e.target.value })}
              >
                {TERM_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(`glossary.type.${type}`)}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>{t('glossary.priority')}</label>
              <input
                type="number"
                value={draft.priority}
                onChange={(e) =>
                  setDraft({ ...draft, priority: Number(e.target.value) || 0 })
                }
              />
            </div>
            <div className="form-group">
              <label>
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
                />
                {t('glossary.enabled')}
              </label>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={() => setModalOpen(false)}>
                {t('common.cancel')}
              </button>
              <button
                type="button"
                data-testid="glossary-save"
                onClick={() => void handleSave()}
                disabled={
                  saving ||
                  !draft.sourceTerm.trim() ||
                  (!draft.doNotTranslate && !draft.targetTerm.trim())
                }
              >
                {saving ? t('common.saving') : t('common.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      <p className="glossary-ai-link">
        <Link to="/admin/ai-pipeline">{t('glossary.aiPipelineLink')}</Link>
      </p>
    </div>
  );
}
