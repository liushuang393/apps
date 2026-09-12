# 02 — 観測 producer と主線 consumer を QoE decision に揃える

**What to build:** Ingress・Runtime・測定 monitor は事実だけを報告し、orchestrator／出力側は QoE decision の可否フラグだけを消費する。聞く主線の停止／継続が monitor の独自判定や経路ごとの分岐に依存しなくなる。

**Blocked by:** 01 — QoE 縮退 evaluate 権威を型付きで確立する

**Status:** done

- [x] Hybrid QoS monitor 相当は P95 等の測定と warning に限定され、hearing 停止の最終判断を返さない
- [x] Ingress overload・Runtime 再接続・Provider 状態は QoE input として報告され、各所に縮退 policy の複製がない
- [x] orchestrator／出力経路は decision を再計算せず、可否フラグと理由コードを消費する
- [x] 結合確認では decision 注入により「聞く主線停止・読む主線と確定発話は継続」が外部挙動として再現される
- [x] 既存イベントは加算的に理由コードを持て、旧クライアントの fallback フラグは維持される

**Phase:** A  
**Spec:** issues/02-qoe-single-authority.md  
**Candidate:** 2
