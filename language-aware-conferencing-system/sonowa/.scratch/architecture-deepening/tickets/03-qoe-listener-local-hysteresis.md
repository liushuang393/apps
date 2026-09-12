# 03 — 受聴者単位劣化と回復ヒステリシスを QoE に集約する

**What to build:** packet loss が高い参加者だけが字幕へ縮退し、会議全体の Mode A は止まらない。品質回復直後の on/off フラッピングがなく、条件充足後は定義された cooldown を経て翻訳音声へ自動復帰する。

**Blocked by:** 01 — QoE 縮退 evaluate 権威を型付きで確立する

**Status:** done

- [x] server decision と listener-local decision が区別され、個人 RTCStats が会議全体の聞く主線を止めない
- [x] 受聴者単位 Media degraded が優先順位の末尾として明示され、単独／複合シナリオで検証できる
- [x] 回復のヒステリシスと cooldown が QoE authority に集約され、monitor 側の独自履歴破棄で復帰しない
- [x] cooldown 中は状態が維持され、回復後は changed 付きで聞く主線再開が観測できる
- [x] UI が使える一貫した理由コード（degraded / interrupted / recovered）が decision から得られる

**Phase:** A  
**Spec:** issues/02-qoe-single-authority.md  
**Candidate:** 2
