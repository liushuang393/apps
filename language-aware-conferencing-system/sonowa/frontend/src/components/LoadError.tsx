/**
 * 読込失敗表示（エラー文言 + 再試行ボタン）
 * データ取得画面が API 失敗時に「読み込み中」で固まらないよう共通で使う。
 */
import { useTranslation } from 'react-i18next';

interface LoadErrorProps {
  /** 表示するエラー文言（翻訳済み） */
  message: string;
  /** 再試行ボタン押下時の処理（再取得） */
  onRetry: () => void;
  /** data-testid の接頭辞（`<prefix>-load-error` / `<prefix>-retry`） */
  testIdPrefix: string;
}

/**
 * 読込失敗の表示
 * 入力: message / onRetry / testIdPrefix
 * 出力: エラー文言と再試行ボタン
 * 注意: 既存の .empty-state / .error スタイルを流用する
 */
export function LoadError({ message, onRetry, testIdPrefix }: LoadErrorProps) {
  const { t } = useTranslation();
  return (
    <div className="empty-state" data-testid={`${testIdPrefix}-load-error`} role="alert">
      <div className="error">{message}</div>
      <button
        type="button"
        className="btn-sm"
        data-testid={`${testIdPrefix}-retry`}
        onClick={onRetry}
      >
        {t('common.retry')}
      </button>
    </div>
  );
}
