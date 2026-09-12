# Sonowa MVP — データフロー

> シナリオ間で「どの seed がどこに影響するか」を可視化する。

## 1. 入口

| 入口 | 経路 | 認証 |
|---|---|---|
| Web UI | `http://localhost:5273` → API | <cookie \| jwt \| none> |

## 2. エンティティ

| エンティティ | DB テーブル | 定義場所 |
|---|---|---|
| <Entity> | `<table>` | `<file:line>` |

## 3. 主要フロー

```
UI -> API -> Service -> Repository -> DB
```

## 4. seed 影響表

| seed 名 | 触るテーブル | 関連 ID |
|---|---|---|
| `auth-roles` | `roles`, `user_account` | `AUTH-*`, `PERMISSION-*` |
| `basic` | <主要テーブル> | <ID 範囲> |

## 5. 外部依存 mock 方針

| 外部 | 通常 mock |
|---|---|
| LLM | `force_mock_llm` autouse fixture |
| OAuth | <local stub> |
| Email | <captured-mail fixture> |

## 6. 既知の落とし穴

- <記入>
