import { useRoomStore } from '../store/roomStore';
import type { AudioMode, SupportedLanguage } from '../types';

/** 参加者設定に適用できる変更項目。 */
export interface PreferencePatch {
  audioMode?: AudioMode;
  subtitleEnabled?: boolean;
  targetLanguage?: SupportedLanguage;
}

/**
 * 参加者設定をローカル状態へ反映し、同じ変更をリモートへ同期する。
 *
 * @param patch 適用する参加者設定の差分
 * @param syncRemote リモートへ設定差分を同期するコールバック
 */
export function applyPreferenceChange(
  patch: PreferencePatch,
  syncRemote: (patch: PreferencePatch) => void,
): void {
  useRoomStore.getState().updateMyPreference(patch);
  syncRemote(patch);
}
