# Sonowa テスト／E2E 文書索引

本ディレクトリは、Sonowa MVP の **包括 E2E・品質ゲート・testing-kit 連携** に関する設計と運用の正本置き場です。

最終更新: 2026-09-06

## 読む順番

| 順 | 文書 | 内容 |
|----|------|------|
| 1 | [e2e-architecture-design.md](./e2e-architecture-design.md) | 基本設計・責務分割・契約モデル・A/B レーン |
| 2 | [runbook.md](./runbook.md) | 理想手順（一歩一通る）運用ランブック |
| 3 | [kit-improvement-backlog.md](./kit-improvement-backlog.md) | testing-kit 側の改善バックログ |
| 4 | [sonowa-improvement-backlog.md](./sonowa-improvement-backlog.md) | Sonowa 本体側の改善バックログ |
| 5 | [report/README.md](./report/README.md) | レポート成果物と再生成手順 |
| 6 | [report/quality-verdict.md](./report/quality-verdict.md) | 品質合否テンプレート |

## 関連（リポジトリ他箇所）

| パス | 役割 |
|------|------|
| [`e2e/`](../../e2e/) | testing-kit 形式の E2E 正本（Playwright） |
| [`e2e/docs/`](../../e2e/docs/) | シナリオ業務フロー・マトリクス |
| [`IMPLEMENTATION_PLAN.md`](../../IMPLEMENTATION_PLAN.md) | 実装ステージ進捗 |
| [`docs/テスト観点.md`](../テスト観点.md) | 実業務合否観点（表示＋動作） |
| [`scripts/e2e_run_a_lane.sh`](../../scripts/e2e_run_a_lane.sh) | A レーン実行入口 |
| [`scripts/e2e_run_b_lane.sh`](../../scripts/e2e_run_b_lane.sh) | B レーン実行入口（実 AI ゲート付き） |
| `<testing-kit>` | 外部 testing-kit v0.3.0（installed-kit 利用） |

## 方針要約（1 段落）

**手順は共通、差分は契約で宣言、固有ロジックだけ埋める。**  
認証 bypass 禁止。自前 auth/DB/route は実物。外部 AI だけ A レーンで境界化（最終形は HTTP stub、暫定は process `mock`）。B レーンは主要 2 フローのみ実 AI。UI 合格だけでは不十分で、API／DB／LiveKit の第二観測を必須とする。
