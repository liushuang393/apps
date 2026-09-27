# 設計

## hooks のエラー（R1, R5）

- `useLiveKit` 等は react-i18next の `useTranslation()` を使わず、`i18n` インスタンス（`src/i18n/index.ts` の default export）の `i18n.t()` をエラー発生時に呼ぶ。
  - 理由: `t` を effect の依存に入れると言語切替で LiveKit 再接続・デバイス再列挙が走る（R5）。エラー文は発生時の言語で確定すればよい。
- キー: `errors.livekit.*`, `errors.audio.*`, `errors.devices.*`。

## backend API エラー（R2, R3）

- 辞書は locale の `apiError.*`。**ja の値 = backend の detail 原文**（f-string は `{{value}}` 等の補間）。
- `api/http.ts` で `ApiError` を作る時点で `translateApiDetail(detail)` を通す:
  1. ja の `apiError` 値と完全一致するキーを探す → `i18n.t('apiError.<key>')`
  2. 補間テンプレートは正規表現化して一致 → 捕捉値を補間して `i18n.t`
  3. 不一致 → 原文を返す
  - 非文字列 detail（422 の配列等）は `apiError.generic`（ja = 従来の `APIエラー`）
- 実装は `src/api/apiErrorText.ts`（純関数 + i18n 参照）。`http.ts` から 1 行呼ぶ。
- `ApiError.status` とメッセージ以外の挙動は不変。既存の `err.status === 503` 分岐はそのまま動く。
- ずれ検出（R3）: Vitest が `../backend/app/**/*.py` を読み、`detail="..."` / `detail=f"..."` を抽出し、literal は ja 辞書に完全一致、f-string は `{expr}` → 補間化したテンプレートが ja 辞書に存在することを検査する。

## 互換

- ja UI: ja 辞書 = backend 原文なので表示は同一。
- 未知メッセージ: 原文表示（従来どおり）。

## ロールバック

- `http.ts` の 1 行を外せば従来動作。hooks は文字列置換のみ。
