# 会議・管理画面の UI 文字列を i18n 化

## Goal

UI 言語を切り替えても日本語のまま残る画面をなくす。対象 9 ファイルの直書き日本語 UI 文字列を `react-i18next` の `t()` に置き換え、ja/en/zh/vi の 4 ロケールに訳を追加する。

## 対象

- pages: AdminPage, ExperimentsPage, RoomListPage, RoomPage, TranscriptPage
- components: AudioControlPanel, ParticipantList, PreferencePanel, SubtitleDisplay

## Requirements

- R1: 画面に表示される文字列（テキスト、placeholder、title、aria-label、alert/confirm、エラーメッセージ）を `t()` 化。コメントとログは対象外。
- R2: **ja の文言は現行と一字一句同じ**（E2E は `locale: ja-JP` で日本語テキストに依存しうる）。
- R3: 4 ロケールのキー集合が完全一致。既存キー（`common.*`, `room.*`, `meeting.*` 等）で同義のものは再利用、新規はファイル/画面単位の名前空間（例 `admin.*`, `experiments.*`, `transcript.*`, `audioControl.*`）。
- R4: 動的値は i18next 補間（`{{count}}` 等）。文字列連結で文を組み立てない。
- R5: `hooks/useTranslation.ts`（翻訳 API フック）と react-i18next の `useTranslation` の名前衝突に注意し、既存の import を壊さない（必要なら `import { useTranslation as useI18n }` 等の別名）。
- R6: API から来るデータ・言語名（`LANGUAGE_NAMES`）・ユーザー入力は翻訳しない。
- R7: 振る舞いを変えない。

## Acceptance Criteria

- [x] AC1: 対象 9 ファイルで、コメント以外の行に日本語 UI 文字列が残らない（残す場合は理由を列挙）
- [x] AC2: 4 ロケールのキー集合一致をスクリプトで確認
- [x] AC3: ja の表示文言が変更前と同一（抽出前後の ja 文字列対照表で確認）
- [x] AC4: `npm run type-check` / `lint` / `build` / `npm test` 成功
- [x] AC5: 英語 UI でルームリスト・会議室・会議記録・管理画面を開くと英語表示（ブラウザ確認、可能な範囲で）

## Out of Scope

- 既に i18n 済み画面の修正、バックエンドのエラーメッセージ多言語化、翻訳 API フックの改名

## Closeout (2026-09-26)

- 216 文字列を t() 化、新規キー 133（4 ロケール 351 キーで一致）。locales.test.ts でキー集合・`{{var}}` 一致を恒久検査。
- ja 文言同一: 187 件は値一致、29 件の補間系は i18next 出力比較で不一致 0。trellis-check で再確認、指摘なし。
- Playwright smoke+regression（ja-JP、稼働中 Docker スタック・src マウントの Vite dev）22/22 passed。
- AC5 は API モックの headless 確認（実バックエンドでの英語 UI 目視は未実施）。
- 残: useLiveKit の接続エラー文言、LANGUAGE_NAMES、ja-JP 固定の日付書式は未 i18n（対象外）。
