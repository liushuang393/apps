# 品質判定書（テンプレート）

> 記入日: `YYYY-MM-DD`  
> 実行者: `{{OPERATOR}}`  
> 対象リビジョン: `{{GIT_SHA}}`  
> レーン: `A` / `B`（いずれかを残す）

## 1. 判定サマリ

| 項目 | 結果 | メモ |
|------|------|------|
| 総合判定 | `PASS` / `FAIL` / `BLOCKED` | {{OVERALL_NOTES}} |
| Aレーン（モック AI E2E） | `PASS` / `FAIL` / `SKIP` | {{A_LANE_NOTES}} |
| Bレーン（実 AI 品質） | `PASS` / `FAIL` / `SKIP` | {{B_LANE_NOTES}} |

## 2. 環境

| キー | 値 |
|------|-----|
| Frontend URL | `{{FRONTEND_URL}}` |
| Backend URL | `{{BACKEND_URL}}` |
| `AI_PROVIDER`（effective） | `{{AI_PROVIDER}}` |
| `LAMS_E2E_MOCK_AI` | `{{LAMS_E2E_MOCK_AI}}` |
| ブラウザ / Playwright | `{{BROWSER}}` |

## 3. Aレーン結果（決定論・Mock AI）

| チェック | 結果 | 証跡 |
|----------|------|------|
| ログイン〜会議室入退室 | `{{A_FLOW}}` | `{{A_FLOW_ARTIFACT}}` |
| data-testid セレクタ安定 | `{{A_TESTID}}` | `{{A_TESTID_ARTIFACT}}` |
| Mock ASR/MT/TTS 単体 | `{{A_UNIT}}` | `pytest tests/test_mock_provider.py` |
| 失敗一覧 | `{{A_FAILURES}}` | |

## 4. Bレーン結果（実 AI）

| 指標 | 目標 | 実測 | 判定 |
|------|------|------|------|
| 端到端遅延（字幕） | `{{TARGET_SUB_LATENCY_MS}}` ms | `{{ACTUAL_SUB_LATENCY_MS}}` | `{{SUB_LATENCY_VERDICT}}` |
| 端到端遅延（翻訳音声） | `{{TARGET_TTS_LATENCY_MS}}` ms | `{{ACTUAL_TTS_LATENCY_MS}}` | `{{TTS_LATENCY_VERDICT}}` |
| 訳質（サンプル N=`{{N}}`） | 人手基準 | `{{MT_QUALITY_NOTES}}` | `{{MT_VERDICT}}` |
| 重大不具合 | 0 | `{{CRITICAL_BUGS}}` | `{{BUG_VERDICT}}` |

## 5. 3軸カバレッジ（任意）

| 軸 | カバレッジ | 未カバー |
|----|------------|----------|
| route | `{{ROUTE_COVERAGE}}` | `{{ROUTE_UNCOVERED}}` |
| role | `{{ROLE_COVERAGE}}` | `{{ROLE_UNCOVERED}}` |
| CRUD | `{{CRUD_COVERAGE}}` | `{{CRUD_UNCOVERED}}` |

## 6. ブロッカー / フォローアップ

- `{{BLOCKER_1}}`
- `{{FOLLOWUP_1}}`

## 7. 署名

- 判定者: `{{APPROVER}}`
- 承認日: `{{APPROVED_ON}}`
