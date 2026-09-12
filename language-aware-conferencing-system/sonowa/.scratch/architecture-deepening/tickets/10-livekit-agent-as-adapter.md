# 10 — LiveKitAgent を frame／end adapter に縮小する

**What to build:** LiveKitAgent は room／track lifecycle と PCM 変換に限定され、トラックごとに Ingress pipeline へ frame／end／cancel を渡すだけになる。取り込み政策の変更が LiveKit イベント処理と同居せず、Media Plane としての LiveKit 利用は維持される。

**Blocked by:** 09 — 取り込み主線を Ingress pipeline として切り出す

**Status:** done

- [x] LiveKitAgent から VAD／Queue／worker／overload policy の所有が外れ、pipeline へ委譲されている
- [x] track イベントが pipeline へ frame と end を渡す配線が統合テスト（または同等）で確認できる
- [x] 話者ごとに pipeline instance が分離され、一人の遅延が他話者取り込みを止めない
- [x] track 終了時に Queue／worker が確実に閉じ、zombie task が残らない
- [x] 既存の確定発話保護・話者順・過負荷縮退の外部挙動が維持される
- [x] LiveKit から別 Media Plane への移行は行っていない

**Phase:** D  
**Spec:** issues/05-extract-ingress-mainline.md  
**Candidate:** 5
