# api/client.ts をドメイン別に分割

## Goal

`frontend/src/api/client.ts`（902 行、CLAUDE.md 推奨 500 行超）をドメイン別に分割する。CLAUDE.md「テストを先に書いてから分割」に従い、先に Vitest を導入して現挙動を特性テストで固定する。

## Requirements

- R1: `vitest` を devDependency に追加し、`npm test`（`vitest run`）を用意する。jsdom 等は必要な場合のみ。
- R2: 分割前に特性テストを書く: `ApiError`、`apiFetch`（Authorization ヘッダ付与、エラー時 `ApiError` の status/message、204 空成功）、各 `convertXxx`（snake_case → camelCase）、各 `xxxApi` の代表メソッドの URL / method / body。`fetch` は `vi.stubGlobal` でモック。
- R3: `client.ts` をドメイン別モジュール（例: `http.ts` = ApiError/apiFetch/API_BASE、`auth.ts`、`rooms.ts`、`admin.ts`、`glossary.ts`、`meetings.ts`）に分割。各 300 行以内目標。
- R4: `api/client.ts` は再エクスポートのみ残し、既存の `import ... from '../api/client'` を一切変更せずに動くこと。
- R5: 振る舞い・公開型・エクスポート名を変えない。
- R6: `useTranslation.ts` の直 fetch 等、他ファイルの負債には触れない（別件）。

## Acceptance Criteria

- [x] AC1: 分割前のコミット状態で特性テストが全件 GREEN
- [x] AC2: 分割後も同じテストが無変更で全件 GREEN
- [x] AC3: `npm run type-check` / `npm run lint` / `npm run build` 成功
- [x] AC4: 分割後の各ファイル 500 行未満、`client.ts` は再エクスポートのみ
- [x] AC5: `src/` 配下の既存 import 文に差分なし（`git diff` で api/ 以外の src 変更なし）

## Out of Scope

- API 契約・振る舞いの変更、snake_case 漏れ（auth 応答）の是正、`useTranslation.ts` 修正、check.sh へのテスト組込み

## Closeout (2026-09-26)

- 特性テスト 34 件: HEAD の元 client.ts（902 行）でも分割後でも 34/34 GREEN（メインセッションで元ファイルを一時復元して独立確認）。
- type-check / lint / build 成功、src/api 外の差分なし。trellis-check: ロジック同一・公開エクスポート同一・循環なし、指摘なし。
- spec（directory-structure / quality-guidelines / type-safety / hook / state）を Vitest 導入と api 分割に合わせて更新。
