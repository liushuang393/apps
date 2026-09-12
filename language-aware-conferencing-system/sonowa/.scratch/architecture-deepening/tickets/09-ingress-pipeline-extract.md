# 09 — 取り込み主線を Ingress pipeline として切り出す

**What to build:** 実 LiveKit なしで frame／end／cancel を投入すると、確定発話の順序維持・過負荷時の確定保護・partial の最新優先・tail flush・snapshot 観測が独立 Ingress pipeline として検証できる。QoE には overload 事実だけを報告し、縮退判定は行わない。

**Blocked by:** 01 — QoE 縮退 evaluate 権威を型付きで確立する

**Status:** done

- [x] frame／end／cancel／snapshot を持つ Ingress pipeline 公開 interface がある
- [x] fake downstream と制御時計で、順序維持・話者分離・soft no-drop・hard／max-age 明示 drop・partial 優先度・downstream 例外後継続・tail flush・end／cancel 資源回収が検証できる
- [x] soft limit では確定発話を受理して overload を報告し、hard／max-age のみ理由付き破棄する
- [x] Queue 観測は QoE authority へ事実として報告し、pipeline 内で縮退 decision を複製しない
- [x] LiveKit／DB 型を受け取らない型付き downstream（確定・暫定）を注入できる
- [x] private Queue／worker を直接叩くテスト前提から公開 seam へ移行している

**Phase:** D  
**Spec:** issues/05-extract-ingress-mainline.md  
**Candidate:** 5
