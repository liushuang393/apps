# 03 — 過負荷・縮退状態を会議室 UI で区別表示する

**What to build:** 参加者が「接続切断」ではなく「過負荷による翻訳音声縮退」だと分かるよう、会議室画面で degraded 状態を短文表示する。

**Blocked by:** 01 — soft_limit 超過でも確定発話を落とさず Mode A を縮退する

**Status:** ready-for-agent

- [ ] overload / qos 縮退イベント受信で UI が degraded を示す
- [ ] 既存の接続状態（connecting / reconnecting 等）と混同しない
- [ ] 過負荷解除後に表示を戻せること（または警告が陳腐化しないこと）
- [ ] 未知のイベントフィールドを受け取っても画面が壊れない
