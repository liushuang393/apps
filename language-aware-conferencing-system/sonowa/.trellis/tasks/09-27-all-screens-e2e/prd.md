# 全画面・遷移の E2E 網羅と読み込み固着バグ修正

## 報告されたバグ

`/admin/ai-pipeline` が「読み込み中...」のまま進まない（2026-09-27、ユーザー報告・スクショ）。

原因（確認済み）: `AiPipelineSettingsPage` は `if (isLoading || !form || !settings)` で読込表示を出すため、API 失敗時（`settings=null`・`error` 設定済み）も永久に読込表示のままでエラーも再試行も出ない。発生時刻は backend 再起動（GPU モデル warmup 約 1 分）中で、nginx が 502 を返した可能性が高い。

## Goal

1. API が一時的に失敗しても、どの画面も「読み込み中」で固まらず、理由と再試行手段を表示する。
2. 全ルートを、ロール別に「直接アクセス」「メニューからの遷移」「API 失敗」「英語 UI」の観点で恒久 E2E 化し、同種の見落としを再発させない。

## 対象ルート

公開: `/login` `/register` `/forgot-password` `/reset-password`
認証: `/menu` `/profile` `/history` `/rooms` `/room/:id` `/room/:id/transcript`
管理者: `/admin` `/admin/languages` `/admin/ai-pipeline` `/admin/experiments` `/admin/glossary`

## Requirements

- R1: `AiPipelineSettingsPage` は読込失敗時にエラーと「再試行」を表示する。
- R2: 全データ取得画面（上記の認証・管理者ルート、`MeetingModePanel` 含む）を監査し、失敗時に固着・白画面・無反応になるものを同様に修正。既存の正常表示・`data-testid` は不変。
- R3: 画面に残る直書き日本語（`LanguageSettingsPage` のエラー既定文言、`AiPipelineSettingsPage` 等）を i18n 化。backend の ai-pipeline `warnings`（日本語）は既存 `translateApiDetail` と同じ辞書方式で UI 言語表示し、ずれ検出テストの対象に含める。
- R4: 恒久 E2E（`e2e/regression/`、シナリオ ID 規約 `[NAV-00x]` 等に従う）:
  - NAV-001: user / admin それぞれで全許可ルートを直接開き、ページの `data-testid` が出て、読込表示が一定時間内に消え、`pageerror` と想定外の 4xx/5xx が無い。
  - NAV-002: メニューの全項目をクリックで遷移し、戻る（ヘッダーの戻る / ブラウザバック）で元に戻る。会議室一覧→会議室→会議記録→戻る の導線を含む。
  - NAV-003: 権限外ルート（user で `/admin/*`、未認証で認証ルート）がメニュー / ログインへ誘導される。
  - NAV-004: 各データ画面で API を 502 に差し替えると、読込表示が消えてエラーが出る。再試行（またはリロード）で正常表示に戻る。**今回のバグの回帰テスト**。
  - NAV-005: 英語 UI で全ルートを開き、アプリ由来の日本語が表示されない（ユーザー入力・テストデータ名は除外）。
- R5: 本番構成（GPU+HTTPS）へ発布し、smoke / regression / meeting / 新規 NAV を全件実行する。

## Acceptance Criteria

- [ ] AC1: API 502 で `/admin/ai-pipeline` を開くとエラーと再試行が出て、再試行で設定画面が出る（修正前は固着することを先に確認＝RED）
- [ ] AC2: NAV-001〜005 が本番構成で全件成功
- [ ] AC3: 既存 smoke / regression / meeting が全件成功
- [ ] AC4: 英語 UI で ai-pipeline の警告が英語表示（スクショ）
- [ ] AC5: npm test / type-check / lint / build / check.sh / pytest（該当）成功、trellis-check 指摘解消

## Out of Scope

- 画面デザイン変更、backend API 形式変更、ファイル分割
