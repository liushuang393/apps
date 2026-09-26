# check.sh の lint 失敗を終了コードに反映

## Goal

`./scripts/check.sh` は「コミット前にエラー0を確認」のゲートだが、Ruff lint / Ruff format / ESLint の失敗は表示だけで exit 0 になる。失敗を終了コードに反映する。

## Requirements

- チェックモード: Ruff lint / format / ESLint のいずれかが失敗したら、全チェックを最後まで実行した後に exit 1
- `--fix` モード: 自動修正後も残るエラーがあれば exit 1
- `--format` モードの挙動は変えない
- 既存の即時 exit（ruff 不在・構文エラー・型エラー）は維持

## Acceptance Criteria

- [x] AC1: クリーンな状態で `./scripts/check.sh` が exit 0
- [x] AC2: ESLint エラーを一時的に入れると exit 1（他のチェックも実行される）
- [x] AC3: Ruff lint エラーを一時的に入れると exit 1
- [x] AC4: `bash -n` 構文 OK

## Out of Scope

- CI 設定の変更、チェック項目の追加

## Closeout (2026-09-26)

- ESLint のみ失敗（型チェック OK）→ exit 1、Ruff lint のみ失敗 → exit 1、クリーン → exit 0 を一時プローブファイルで確認（プローブは削除済み）。
