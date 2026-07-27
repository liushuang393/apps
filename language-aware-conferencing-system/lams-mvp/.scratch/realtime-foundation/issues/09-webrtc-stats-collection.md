# 09 — WebRTC Stats を収集して品質判定に渡す

**What to build:** ブラウザから RTT / jitter / packet loss 等の Media Plane 指標を周期収集し、本文や秘密情報を含めずに品質判定へ渡せる。

**Blocked by:** 03 — 過負荷・縮退状態を会議室 UI で区別表示する

**Status:** ready-for-agent

- [ ] RTT / jitter / packet loss（および可能な範囲で concealedSamples / TURN・ICE 種別）を取得できる
- [ ] 送信周期とペイロードサイズに上限がある
- [ ] 会議本文・API Key・LiveKit Token が Stats 経路に乗らない
- [ ] Stats 欠損時に誤った自動縮退を起こさない（不明として扱う）
- [ ] 収集失敗でも会議室接続自体は維持される
