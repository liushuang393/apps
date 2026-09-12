## ステージ1: Contract — legacy OutputSink delivery 削除
**目的**: TransportAdapter（publish_audio / send_data）を唯一の配信境界にする。
**成功条件**:
- `deliver_*` / OutputSinkTransportAdapter の本番・テスト呼び出しがゼロ
- LiveKitOutputSink は publish_audio / send_data のみ
- resolve_transport_adapter は TransportAdapter 必須（fail-fast）
- 指定 pytest が緑
**タスク分解**:
- 在庫確認と factory / sink_adapter 削除
- LiveKitOutputSink から deliver_* 削除
- テストを RecordingTransportAdapter / publish_audio+send_data へ移行
- orchestrator OutputSink Protocol を TransportAdapter に置換
**進捗状況**: 完了

## ステージ2: `_subtitle_message` テスト移行と削除
**目的**: 死んだ helper を消し、字幕イベント断言を生きている経路へ移す。
**成功条件**:
- `_subtitle_message` 削除
- partial/final 断言が DefaultOutputManager 経由
- `_deliver_*_group` を再導入しない
**タスク分解**:
- test_partial_subtitle / test_orchestrator を OM 経路へ移行
- HybridOrchestrator._subtitle_message 削除
**進捗状況**: 完了

## ステージ3: 検証
**目的**: 指定 pytest + ruff が緑。
**成功条件**: ユーザー指定コマンドが成功
**タスク分解**:
- pytest 実行
- ruff check/format
**進捗状況**: 完了

## E2E ステージ1: harness 基盤（existing-server）
**目的**: testing-kit v0.3.0 上に Sonowa 用 project marker / profile / app.toml / app-owned-runtime を固定する。
**成功条件**:
- `.testing-kit-project` / `.testing-kit/project-profile.yaml` が存在する
- `e2e/app.toml` が `auth.mode=login`, `seed_mode=self`, `requires_db=false`, `deployment.default_mode=existing-server`
- identity_probe（`/__testing_kit_identity`）に依存しない
- `app-owned-runtime.json` が docker compose / auth_setup / safe noop data / playwright smoke を宣言
**Tests**: `python e2e/scripts/auth_setup.py`（API /health 到達時）
**進捗状況**: 完了

## E2E ステージ2: JWT auth helper + smoke/regression 骨格
**目的**: 実 JWT（bypass なし）で AUTH/ROOM/HEALTH/ADMIN/PREF/SUBTITLE シナリオを自動化する。
**成功条件**:
- `helpers/auth.ts` が login/register + `sonowa-auth` zustand persist 注入
- `helpers/api.ts` が rooms / transcript / ai-pipeline を Bearer 付きで呼べる
- smoke: AUTH-001/002, ROOM-001, HEALTH-001, SAMPLE-001
- regression: ADMIN-001, PREF-001, SUBTITLE-001
- business-flows と test-matrix.csv が同期
**Tests**: `./scripts/e2e_run_a_lane.sh`（5273/8090 起動時）
**進捗状況**: 完了

## E2E ステージ3: A レーン安定化
**目的**: existing-server での反復実行を安定化し、レポートを `docs/testing/report/` に残す。
**成功条件**:
- `E2E_ALLOW_NO_DB=1` で共有 DB wipe 無し
- 失敗時も summary markdown が残る
- LiveKit 未起動時は PREF が soft-skip（失敗にしない）
**Tests**: A レーン再実行でフレーク調査
**進捗状況**: 完了（8 passed / 1 skipped ×2、flaky 0。証跡: `docs/testing/report/a-lane-summary.md`）

## E2E ステージ4: B レーン（実 AI / LiveKit）
**目的**: `E2E_ALLOW_REAL_AI=1` 時のみ LiveKit 2 クライアントと ai-pipeline smoke を走らせる。
**成功条件**:
- `./scripts/e2e_run_b_lane.sh` がゲート付きで動く
- タイムアウト上限付き
**Tests**: `test_livekit_two_clients` + `smoke_ai_pipeline_settings.py`
**進捗状況**: 完了（smoke GREEN。LiveKit は Docker sock Permission denied + :7880 未到達で BLOCKED・証跡付き）

## E2E ステージ5: CI / 文書締め
**目的**: 実行手順・ブロッカー・マトリクスを開発者向けに確定する。
**成功条件**:
- Docker 不可時の existing-server 手順が文書化済み
- admin は env 任意であることの注記
- kit schema と共有 DB の整合: `data_identity.kind=file` + no-wipe marker（wipe は safe_noop）
**Tests**: ドキュメントレビュー + `quality-verdict.md`
**進捗状況**: 完了（`docs/testing/report/quality-verdict.md` / `failure-classification.md`）

## 設計アーカイブ（2026-09-06）
**目的**: 基本設計・改善案・運用手順を `docs/testing/` に固定し、実装とバックログの正本にする。
**成果物**:
- [`docs/testing/README.md`](docs/testing/README.md) … 索引
- [`docs/testing/e2e-architecture-design.md`](docs/testing/e2e-architecture-design.md) … 基本設計
- [`docs/testing/runbook.md`](docs/testing/runbook.md) … 運用ランブック
- [`docs/testing/kit-improvement-backlog.md`](docs/testing/kit-improvement-backlog.md) … testing-kit 改善
- [`docs/testing/sonowa-improvement-backlog.md`](docs/testing/sonowa-improvement-backlog.md) … Sonowa 本体改善
- [`docs/superpowers/specs/2026-09-06-e2e-testing-kit-design.md`](docs/superpowers/specs/2026-09-06-e2e-testing-kit-design.md) … 要約スペック
**進捗状況**: 完了
