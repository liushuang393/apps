# 14 — 旧 QoS 系の deletion test と利用 inventory を設ける

**What to build:** 旧 QoS controller 系が production composition から到達不能か、互換 API として必要かが自動検証と inventory で判明する。削除そのものは行わず、到達不能かつ現行 QoE／HybridQoS 挙動が代替している場合にのみ後続の小さな削除変更を許可する判定材料を残す。

**Blocked by:** 02 — 観測 producer と主線 consumer を QoE decision に揃える

**Status:** done

- [x] production composition／runtime import／公開 API／テスト専用 import を区別した利用 inventory がある
- [x] architecture／deletion seam が、現行 monitor＋QoE だけが到達可能であることと品質 behavior baseline（P95 warning・縮退・cooldown・用語／数字）を検証する
- [x] 単純な全文検索ではなく production dependency boundary を検証する
- [x] 利用が見つかった場合は測定／warning／縮退 decision へ分類し、即時削除しない判断が issue に残る
- [x] 外部互換が必要な場合は deprecation／adapter 方針が書かれ、即時削除しない
- [x] 旧系が production 依存として再導入されたら deletion test が失敗する guard になっている
- [x] 本チケット単体では旧 QoS 記号を削除しない（speculative 維持）

**Phase:** E  
**Spec:** issues/08-legacy-qos-deletion-test.md  
**Candidate:** 8

## 実装メモ（2026-07-28）

- seam: `backend/app/ai_pipeline/legacy_qos_boundary.py`
- tests: `backend/tests/test_legacy_qos_deletion.py`
- inventory 結論: `pipeline.py` に QoSController／QoSMetrics の測定用途残存あり → 即時削除不可。公開 HTTP API なし。AdaptiveQoSController は production import ゼロだが同居残存のため削除保留。
- 縮退 decision 権威は QoE、測定／warning は HybridQoSMonitor（composition seam で旧 controller 非到達）。
