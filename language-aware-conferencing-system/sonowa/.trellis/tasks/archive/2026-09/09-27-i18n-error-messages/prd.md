# エラーメッセージの多言語化と Docker 実発布検証

## Goal

英語・中国語・ベトナム語 UI でもエラーが UI 言語で表示されるようにする。変更は実際に Docker へ発布し、実バックエンドで検証する。

## 背景

- 前タスク（09-26-i18n-remaining-screens）で画面文言は i18n 化済み。残りはエラー系のみ:
  - `hooks/useLiveKit.ts` / `useAudioCapture.ts` / `useAudioDevices.ts` の `setError` / `setConnectionError`（13 件）とデバイス名フォールバック（`マイク xxxx`）
  - `api/http.ts` の `'APIエラー'` フォールバック
  - backend の `HTTPException(detail="日本語")`（約 40 種、うち f-string 6 種）が `ApiError.message` としてそのまま画面に出る
- ユーザー方針: 1200 行未満のファイルは分割しない（現状最大 916 行 → 分割なし）。

## Requirements

- R1: hooks のエラー文言とデバイス名フォールバックを i18n キー化。デバイス判定用キーワード配列（ヘッドセット等）はデータなので対象外。
- R2: backend API エラーは API 契約を変えずに（`detail` は日本語のまま）フロントで UI 言語へ翻訳する。未知の detail は原文のまま表示（劣化しない）。
- R3: backend の detail 文字列とフロント辞書のずれをテストで検出する。
- R4: ja 表示は従来と同一（E2E ja-JP 互換）。
- R5: 言語切替で LiveKit 再接続などの副作用を起こさない。
- R6: `docker compose up -d --build` で発布し、`alembic upgrade head`、health 確認のうえ、実スタックで E2E（smoke+regression）と英語 UI のエラー表示を確認する。

## Acceptance Criteria

- [x] AC1: 対象 hooks / http.ts のコメント以外に日本語 UI 文字列が残らない（判定キーワード配列を除く）
- [x] AC2: 英語 UI で、実バックエンドの 404（会議室なし）・401（ログイン失敗）・403 などが英語で表示される
- [x] AC3: backend の全 literal / f-string detail に対応する翻訳があることを Vitest が検査し、欠けると失敗する
- [x] AC4: `npm test` / type-check / lint / build、`./scripts/check.sh` 成功
- [x] AC5: `docker compose up -d --build` 後、`docker compose ps` 全サービス稼働、`/health` OK、E2E smoke+regression 全件成功
- [x] AC6: 英語 UI のスクリーンショットで、エラー表示が読める（淡色背景に白文字などコントラスト不良なし）

## Out of Scope

- backend の API 応答形式変更・Accept-Language 対応、LANGUAGE_NAMES / 日付書式、ファイル分割、chunk size 警告
- meeting プロジェクト E2E（実マイク WAV が必要）

## Closeout (2026-09-27)

- 単体: npm test 50/50（RED→GREEN、ドリフト検出の変異テスト確認）。type-check / lint / build / check.sh OK。trellis-check 指摘なし。
- 発布: 最初の `docker compose up -d --build` は GPU オーバーライド無しのため backend が「NVIDIA driver なし」でローカルモデル準備失敗。正規手順 `INSTALL_LOCAL=1 ./scripts/start-docker.sh --build`（.env の ENV=production → nginx HTTPS 443、docker-compose.gpu.yml 付与）で再発布し、CUDA graph 取得・startup complete を確認。alembic head = 017_user_token_version。
- E2E smoke+regression（https://192.168.210.15、本番ビルド）22/22 passed。
- 英語 UI 実確認（一時 spec、削除済み）: 401 ログイン失敗 "Incorrect email address or password"、会議室 404 "Meeting room not found."、会議記録 404 英語表示、ja は従来文言。スクショでコントラスト良好。
- 残: `detail=str(e)`（管理者のパイプライン検証エラー）は原文表示。
