/**
 * A/B 実験 管理ページ（P4-C）
 * 設定済み実験の一覧と、群×指標の集計比較を管理者向けに可視化する。
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  adminApi,
  ApiError,
  type ExperimentInfo,
  type ExperimentSummary,
} from '../api/client';
import { useAuthStore } from '../store/authStore';

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
        setError('管理者権限が必要です');
        return;
      }
      setError('データ読み込みに失敗しました');
    } finally {
      setLoading(false);
    }
  }, [logout, navigate]);

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
      <div className="admin-page">
        <div className="empty-state">読み込み中...</div>
      </div>
    );
  }

  return (
    <div className="admin-page">
      <div className="admin-header">
        <div className="header-left">
          <button onClick={() => navigate('/admin')}>戻る</button>
          <h2>A/B 実験</h2>
        </div>
        <div className="header-right">
          <span className="user-name">{user?.displayName}</span>
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      {experiments.length === 0 ? (
        <div className="empty-state">
          設定済みの A/B 実験がありません（ENABLE_AB_TESTING と EXPERIMENTS_CONFIG を
          設定してください）。
        </div>
      ) : (
        <section className="admin-experiments">
          {experiments.map((exp) => (
            <div key={exp.key} className="experiment-card">
              <div className="experiment-head">
                <strong>{exp.key}</strong>
                <span className="experiment-meta">
                  stage={exp.stage} / unit={exp.unit} /{' '}
                  {exp.enabled ? '有効' : '無効'}
                </span>
                <button
                  onClick={() => void loadSummary(exp.key)}
                  disabled={loadingKey === exp.key}
                >
                  {loadingKey === exp.key ? '集計中...' : '集計を表示'}
                </button>
              </div>

              <table className="experiment-variants">
                <thead>
                  <tr>
                    <th>群</th>
                    <th>model_id</th>
                    <th>重み</th>
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
  const variants = Object.keys(summary);
  if (variants.length === 0) {
    return <p className="experiment-empty">まだ観測データがありません。</p>;
  }
  // 全群に現れる指標名の和集合（列見出し用）。
  const metrics = Array.from(
    new Set(variants.flatMap((v) => Object.keys(summary[v])))
  ).sort();

  return (
    <table className="experiment-summary">
      <thead>
        <tr>
          <th>群 \ 指標</th>
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
                    ? `平均 ${fmt(stat.mean)} / n=${fmt(stat.count)}`
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
