# 14 — 旧 QoS 系の deletion test と利用 inventory を設ける

**What to build:** 旧 QoS controller 系が production composition から到達不能か、互換 API として必要かが自動検証と inventory で判明する。到達不能かつ現行 QoE／HybridQoS 挙動が代替している場合に、小さな follow-up で旧記号を実削除する。

**Blocked by:** 02 — 観測 producer と主線 consumer を QoE decision に揃える

**Status:** done（deletion test 完了 + follow-up 実削除完了）

- [x] production composition／runtime import／公開 API／テスト専用 import を区別した利用 inventory がある
- [x] architecture／deletion seam が、現行 monitor＋QoE だけが到達可能であることと品質 behavior baseline（P95 warning・縮退・cooldown・用語／数字）を検証する
- [x] 単純な全文検索ではなく production dependency boundary を検証する
- [x] 利用が見つかった場合は測定／warning／縮退 decision へ分類し、即時削除しない判断が issue に残る
- [x] 外部互換が必要な場合は deprecation／adapter 方針が書かれ、即時削除しない
- [x] 旧系が production 依存として再導入されたら deletion test が失敗する guard になっている
- [x] follow-up: 旧 QoS 記号を実削除し、pipeline 測定を非権威 API へ移行した
- [x] follow-up: import／定義の両面で再導入防止 guard を強化した

**Phase:** E  
**Spec:** issues/08-legacy-qos-deletion-test.md  
**Candidate:** 8

## 実装メモ（2026-07-28）

- seam: `backend/app/ai_pipeline/legacy_qos_boundary.py`
- tests: `backend/tests/test_legacy_qos_deletion.py`
- inventory 結論（削除前）: `pipeline.py` に QoSController／QoSMetrics の測定用途残存あり。公開 HTTP API なし。AdaptiveQoSController は production import ゼロだが同居残存。

## follow-up 実削除メモ（2026-07-28）

- 削除記号: `QoSController` / `AdaptiveQoSController` / `QoSMetrics` / `QoSState` / `DegradationLevel`（`qos.py` 定義ごと）
- 移行: `pipeline.py` の測定を `PipelineLatencyMetrics`（非権威・縮退フィールドなし）へ置換。縮退 decision は QoE 単一権威のまま
- 公開互換: routes 等の外部 HTTP API 利用なし → deprecation shim なしで削除
- guard: production／test の ImportFrom ゼロ + `qos.py` ClassDef 残存ゼロを deletion test で検証
- 非編集（競合回避）: `orchestrator.py` / `sink.py` / output_manager / ticket06 / PHASES / IMPLEMENTATION_PLAN
