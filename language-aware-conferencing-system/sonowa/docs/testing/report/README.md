# テストレポート（Aレーン / Bレーン）

本ディレクトリは Sonowa MVP の品質証跡レポート置き場です。

設計正本: [../e2e-architecture-design.md](../e2e-architecture-design.md)  
運用手順: [../runbook.md](../runbook.md)

## レーンの区別

| レーン | 目的 | AI | 主な用途 |
|--------|------|-----|----------|
| **Aレーン** | 機能・画面フローの回帰（決定論） | **最終形**: HTTP stub container。**暫定**: `MockAIProvider`（`AI_PROVIDER=mock` または `SONOWA_E2E_MOCK_AI=1`） | Playwright E2E、CI スモーク、data-testid 駆動の UI 検証 |
| **Bレーン** | 実 AI 品質・遅延・訳質の評価 | 本番相当プロバイダー（gpt4o_transcribe 等） | 人手レビュー、主要 2 フロー、遅延 SLA 確認 |

Aレーンは **外部 API キー無し** で動かせます。Bレーンは秘密情報（`.env`）と実ネットワークが必要です。

> testing-kit 正本（`14-MOCK-BOUNDARY`）では release レーンの LLM は **外部 HTTP stub**。process 内 Fake は移行期間のみ許可し、最終的に stub へ置換する（[kit-improvement-backlog.md](../kit-improvement-backlog.md) K5）。

## レポートの再生成手順

### Aレーン（モック AI）

```bash
export SONOWA_E2E_MOCK_AI=1
export E2E_DEPLOYMENT_MODE=existing-server
export E2E_ALLOW_NO_DB=1

# 単体（Mock 決定論）
cd backend && pytest tests/test_mock_provider.py -q

# E2E 入口（推奨）
./scripts/e2e_run_a_lane.sh
```

成果物の例:

- `e2e/playwright-report/`（Playwright HTML / JSON）
- `docs/testing/report/e2e-a-lane-*.md`（summary）
- `quality-verdict.md`（合否記入）

### Bレーン（実 AI）

1. `.env` に本番相当の API キーを設定（エージェントは `.env` を編集しない）
2. `E2E_ALLOW_REAL_AI=1` を明示
3. `./scripts/e2e_run_b_lane.sh` または個別に:
   - `pytest backend/tests/integration/test_livekit_two_clients.py`
   - `python scripts/smoke_ai_pipeline_settings.py`
4. 結果を `quality-verdict.md` に記入（秘密値は書かない）

## 関連ファイル

- [../README.md](../README.md) … テスト文書索引
- `quality-verdict.md` … 品質合否テンプレート
- `backend/app/ai_pipeline/providers/mock_provider.py` … Aレーン暫定 Mock AI
- フロントの `data-testid` … Aレーンセレクタ契約（[sonowa-improvement-backlog.md](../sonowa-improvement-backlog.md) L1）

## 注意

- `mock` は **E2E / Aレーン専用**。本番品質判定には使わない。
- 秘密値をレポートやリポジトリに書き込まない。
- UI だけの緑は不合格。API／DB／LiveKit の第二観測を残す。
