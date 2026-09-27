/**
 * A/B 実験 管理ページ（P4-C）
 * 設定済み実験の一覧と、群×指標の集計比較を管理者向けに可視化する。
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  adminApi,
  ApiError,
  type ExperimentInfo,
  type ExperimentSummary,
} from '../api/client';
import { LoadError } from '../components/LoadError';
import { useAuthStore } from '../store/authStore';
import '../styles/pages/admin.css';

/** 数値を小数 2 桁へ丸めて表示（NaN/未定義は "-"）。 */
function fmt(n: number | undefined): string {
  if (n === undefined || Number.isNaN(n)) return '-';
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

export function ExperimentsPage() {
  const [experiments, setExperiments] = useState<ExperimentInfo[]>([]);
  const [summaries, setSummaries] = useState<Record<string, ExperimentSummary>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const navigate = useNavigate();
  const { user, logout, hasHydrated } = useAuthStore();
  const { t } = useTranslation();

  /** 実験一覧を読み込む。 */
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setExperiments(await adminApi.listExperiments());
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
      setError(t('admin.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [logout, navigate, t]);

  useEffect(() => {
    if (hasHydrated) {
      void loadData();
    }
  }, [hasHydrated, loadData]);

  /** 指定実験の集計を取得して展開する。 */
  const loadSummary = useCallback(async (key: string) => {
    try {
      setLoadingKey(key);
      const summary = await adminApi.getExperimentSummary(key);
      setSummaries((prev) => ({ ...prev, [key]: summary }));
    } catch {
      // 集計取得失敗は当該実験のみ空集計として表示（全体は壊さない）。
      setSummaries((prev) => ({ ...prev, [key]: {} }));
    } finally {
      setLoadingKey(null);
    }
  }, []);

  if (loading) {
    return (
      <div className="admin-page" data-testid="experiments-page">
        <div className="empty-state">{t('common.loading')}</div>
      </div>
    );
  }

  return (
    <div className="admin-page" data-testid="experiments-page">
      <div className="admin-header">
        <div className="header-left">
          <button onClick={() => navigate('/admin')}>{t('common.back')}</button>
          <h2>{t('experiments.title')}</h2>
        </div>
        <div className="header-right">
          <span className="user-name">{user?.displayName}</span>
        </div>
      </div>

      {error ? (
        <LoadError message={error} onRetry={() => void loadData()} testIdPrefix="experiments" />
      ) : experiments.length === 0 ? (
        <div className="empty-state">
          {t('experiments.empty')}
        </div>
      ) : (
        <section className="admin-experiments">
          {experiments.map((exp) => (
            <div key={exp.key} className="experiment-card">
              <div className="experiment-head">
                <strong>{exp.key}</strong>
                <span className="experiment-meta">
                  stage={exp.stage} / unit={exp.unit} /{' '}
                  {exp.enabled ? t('glossary.enabled') : t('glossary.disabled')}
                </span>
                <button
                  onClick={() => void loadSummary(exp.key)}
                  disabled={loadingKey === exp.key}
                >
                  {loadingKey === exp.key ? t('experiments.summarizing') : t('experiments.showSummary')}
                </button>
              </div>

              <table className="experiment-variants">
                <thead>
                  <tr>
                    <th>{t('experiments.variant')}</th>
                    <th>model_id</th>
                    <th>{t('experiments.weight')}</th>
                  </tr>
                </thead>
                <tbody>
                  {exp.variants.map((v) => (
                    <tr key={v.name}>
                      <td>{v.name}</td>
                      <td>{v.modelId}</td>
                      <td>{v.weight}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {summaries[exp.key] && (
                <SummaryTable summary={summaries[exp.key]} />
              )}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

/** 群×指標の集計テーブル（count / mean / min / max）。 */
function SummaryTable({ summary }: { summary: ExperimentSummary }) {
  const { t } = useTranslation();
  const variants = Object.keys(summary);
  if (variants.length === 0) {
    return <p className="experiment-empty">{t('experiments.noData')}</p>;
  }
  // 全群に現れる指標名の和集合（列見出し用）。
  const metrics = Array.from(
    new Set(variants.flatMap((v) => Object.keys(summary[v])))
  ).sort();

  return (
    <table className="experiment-summary">
      <thead>
        <tr>
          <th>{t('experiments.variantByMetric')}</th>
          {metrics.map((m) => (
            <th key={m}>{m}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {variants.map((v) => (
          <tr key={v}>
            <td>{v}</td>
            {metrics.map((m) => {
              const stat = summary[v][m];
              return (
                <td key={m}>
                  {stat
                    ? t('experiments.cellStat', { mean: fmt(stat.mean), n: fmt(stat.count) })
                    : '-'}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
