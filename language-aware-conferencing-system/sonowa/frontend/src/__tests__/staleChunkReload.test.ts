/**
 * 再デプロイ後の旧チャンク読込失敗時の再読込ガードのテスト
 */
import { describe, expect, it } from 'vitest';
import { shouldReloadForStaleChunk, STALE_CHUNK_RELOAD_GUARD_MS } from '../staleChunkReload';

describe('shouldReloadForStaleChunk', () => {
  it('初回（記録なし）は再読込する', () => {
    expect(shouldReloadForStaleChunk(1_000_000, null)).toBe(true);
  });

  it('直前に再読込していればループ防止のため再読込しない', () => {
    const now = 1_000_000;
    expect(shouldReloadForStaleChunk(now, String(now - STALE_CHUNK_RELOAD_GUARD_MS + 1))).toBe(false);
  });

  it('ガード時間を過ぎていれば再読込する', () => {
    const now = 1_000_000;
    expect(shouldReloadForStaleChunk(now, String(now - STALE_CHUNK_RELOAD_GUARD_MS))).toBe(true);
  });

  it('記録値が壊れていれば再読込する', () => {
    expect(shouldReloadForStaleChunk(1_000_000, 'broken')).toBe(true);
  });
});
