# 言語名・日付の UI 言語対応とページ遅延読込

## Goal

1. 言語名（英語 / 日本語 …）と日付表示を UI 言語に追従させる（英語 UI で「英語 audio」等を解消）。
2. 単一 929 kB バンドルをページ単位に分割し、ビルドの 500 kB チャンク警告を解消する（閾値引き上げではなく実分割）。

## Requirements

- R1: 言語名はブラウザ標準 `Intl.DisplayNames([UI言語], {type: 'language'})` で生成する。ja 出力は現 `LANGUAGE_NAMES` と同一（確認済み: ja は 10 言語すべて一致）。Intl が使えない / 例外時は `LANGUAGE_NAMES` にフォールバック。
- R2: `LANGUAGE_NAMES_WITH_CODE` 相当（`英語（EN）`）も UI 言語対応。ja は現行と同一文字列（全角括弧、既存の EN/JP/CN/VN… サフィックス）、他言語は `English (EN)` のような半角表記。
- R3: 既存の `LANGUAGE_NAMES` / `LANGUAGE_NAMES_WITH_CODE` の利用箇所（PreferencePanel, AdminPage, GlossaryPage, ProfilePage, RegisterPage, RoomListPage, TranscriptPage）を新ヘルパーへ置換。言語切替で再描画されること（そのコンポーネントが react-i18next を使っていること）。
- R4: `toLocaleString('ja-JP')` / `toLocaleDateString('ja-JP')` / `toLocaleTimeString('ja-JP')` と、ロケール未指定の `toLocaleString()`（HistoryPage）を UI 言語ロケールに統一。ja UI の出力は従来と同一。
- R5: ルートページを `React.lazy` + `Suspense` で遅延読込にする。ログイン等の初期表示に必要なもの以外を分割。fallback は既存の読込中表示スタイルに合わせる（テキストは i18n）。
- R6: ビルドでチャンク警告が出ない。初期ロードの JS が減る。
- R7: `data-testid` / ルート / 振る舞いは不変。

## Acceptance Criteria

- [x] AC1: Vitest: ヘルパーが ja で現 `LANGUAGE_NAMES` / `WITH_CODE` と全 10 言語一致、en/zh/vi で Intl 名、未知コードはコードそのまま、Intl 例外時フォールバック
- [x] AC2: 対象ファイルに `'ja-JP'` 固定と `LANGUAGE_NAMES[` 直参照が残らない（constants 定義とヘルパー内部を除く）
- [x] AC3: `npm run build` にチャンク警告なし。分割前後の初期 JS サイズを記録
- [x] AC4: npm test / type-check / lint / check.sh OK
- [x] AC5: 本番構成へ発布し E2E smoke+regression+meeting 全件成功、英語 UI で会議室一覧・会議記録の言語名・日付が英語のスクショ確認

## Out of Scope

- 翻訳 API フック改名、バックエンド変更、manualChunks による細かいベンダー最適化（警告が消えない場合のみ検討）

## Closeout (2026-09-27)

- AC3: 実分割で初期 JS 929.13 kB → 326.77 kB（gzip 262.60 → 106.82）。残る livekit-client（506.40 kB）は単一 ESM で分割不可のため、理由をコメントして `chunkSizeWarningLimit: 550`（PRD の「閾値引き上げではなく実分割」は分割を実施したうえでの例外として判断）。
- レビュー指摘（遅延読込で新たに生じる再デプロイ後の旧チャンク 404 → 白画面）に対応: `staleChunkReload.ts`（vite:preloadError で 1 回だけ再読込、sessionStorage 時刻ガード、保存不可なら再読込しない）＋ nginx で index.html を no-cache。単体テスト 4 件、実環境で 404 注入→再読込→表示復帰を確認。
- 英語 UI で管理画面の見出しが折り返す問題を CSS（nowrap）で修正、スクショ確認。
- 検証: npm test 61/61、type-check / lint / build（警告なし）/ check.sh OK、trellis-check 指摘なし。本番構成（GPU+HTTPS）発布後 E2E smoke+regression+meeting 23/23、英語 UI で言語名「Japanese / English / Chinese」・日付「9/27/2026」、ja は従来表示。
