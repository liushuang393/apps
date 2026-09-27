/**
 * 再デプロイ後の旧チャンク読込失敗からの自動復帰
 *
 * ページを React.lazy で分割しているため、開いたままのタブが再デプロイ後に遷移すると
 * 旧ハッシュのチャンクが 404 になり画面が空白になる。Vite の vite:preloadError を受けて
 * 1 回だけ再読込し、最新の index.html とチャンクを取り直す。
 * 注意: 再読込しても失敗が続く場合（サーバー停止等）の無限ループを時刻ガードで防ぐ。
 */

/** 前回の再読込からこの時間内に再発した場合は再読込しない（ミリ秒） */
export const STALE_CHUNK_RELOAD_GUARD_MS = 10_000;

const STORAGE_KEY = 'sonowa-stale-chunk-reload-at';

/**
 * 再読込すべきか判定する（純関数）
 * 入力: 現在時刻、前回再読込時刻の保存値（無ければ null）
 * 出力: 再読込するなら true
 */
export function shouldReloadForStaleChunk(now: number, lastReloadAt: string | null): boolean {
  const last = Number(lastReloadAt);
  return lastReloadAt === null || !Number.isFinite(last) || now - last >= STALE_CHUNK_RELOAD_GUARD_MS;
}

/** vite:preloadError を購読し、条件を満たせば 1 回だけ再読込する */
export function installStaleChunkReload(): void {
  window.addEventListener('vite:preloadError', (event) => {
    const now = Date.now();
    try {
      if (!shouldReloadForStaleChunk(now, sessionStorage.getItem(STORAGE_KEY))) return;
      sessionStorage.setItem(STORAGE_KEY, String(now));
    } catch {
      // ガード時刻を保存できない環境では再読込しない（無限ループ防止。通常のエラー扱い）
      return;
    }
    // 既定のエラー送出を止め、再読込で復帰させる
    event.preventDefault();
    window.location.reload();
  });
}
