# 06 — generation 管理で旧翻訳音声の再生を止める（barge-in）

**What to build:** 同一話者の次発話が始まったら旧 generation の翻訳音声生成を cancel / flush し、遅れて届いた旧音声が会議室で再生されない。

**Blocked by:** 05 — Native 持続セッションで発話ごとの再接続をやめる

**Status:** ready-for-agent

- [ ] 発話ごとに generation_id が単調に進む
- [ ] 新発話開始で旧 generation が cancel される
- [ ] 旧 generation の音声が再生トラックに載らない
- [ ] 割込みから旧音声停止までが目標時間（300ms）以内、または計測可能である
- [ ] interrupted / 同等の状態をイベントまたは UI で扱える
