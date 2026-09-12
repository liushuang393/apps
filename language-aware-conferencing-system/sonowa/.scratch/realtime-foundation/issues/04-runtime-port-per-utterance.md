# 04 — 聞く主線を Runtime Port 経由に移し既定挙動を維持する

**What to build:** 聞く主線（S2S）の呼び出しを RealtimeRuntimePort 経由に統一し、既定設定では現状どおり発話ごとの短命接続のまま会議が動く。

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] hearing 経路が Runtime Port 経由になる
- [ ] 既定（per_utterance）で既存の Mode A / Hybrid 挙動が回帰しない
- [ ] generation / utterance の識別子を発行できる土台がある
- [ ] 設定キーはコード側に追加され、未設定でも既定で起動できる
- [ ] Port の背後以外から Provider SDK を直接叩く新規依存を増やさない
