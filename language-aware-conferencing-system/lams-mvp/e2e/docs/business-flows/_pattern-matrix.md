# 業務パターン行列（テンプレート）

> distill 時にこのファイルを `docs/business-flows/_pattern-matrix.md` としてコピーし、空セルを残さず埋める。
> 正本手順: `testing-kit/docs/00-AI-ENTRY.md` §4。

## 使い方

- セル値は次のいずれか:
  - `SCENARIO-ID`（例: `FAQ-001`）
  - `skip: <固有理由>`（コピペ禁止。キー/エンティティ固有）
  - `HC: <一意の確認質問>?`（owner を表の下に記録）
- inventory key（route/api/role）は「紐付け」列または脚注でセルへ対応付ける。

## 行列

| エンティティ | C | R | U | D | 遷移OK | 遷移NG | 権限OK | 権限NG | 越境 | 監査 | 異常入力 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `<Entity>` | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |

## inventory 紐付け

| inventory key | 行列セル | 備考 |
| --- | --- | --- |
| `api:POST /api/...` | `<Entity>/Create` | |

## HC（一意質問のみ）

| セル | 質問 | owner |
| --- | --- | --- |
| （例）Order/越境 | 他テナントの注文閲覧を E2E で自動実行してよいか？ | `<app>-owner` |

## 未カバー集計

- 空セル（☐）: <N>（0 になるまで次工程へ進まない）
- skip: <N>
- HC: <N>
- scenario 紐付け済: <N>
