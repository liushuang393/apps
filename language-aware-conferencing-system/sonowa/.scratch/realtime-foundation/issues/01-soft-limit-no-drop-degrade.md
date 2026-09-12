# 01 — soft_limit 超過でも確定発話を落とさず Mode A を縮退する

**What to build:** 話者キューが soft_limit を超えても確定発話は破棄せず、翻訳音声（聞く主線）だけ一時停止して確定字幕・記録は続け、会議室に過負荷を通知できる。

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] soft_limit 超過時に final セグメントが破棄されない
- [ ] soft 超過中は聞く主線が止まり、読む主線の確定字幕が継続する
- [ ] 過負荷を示すイベントが受聴者へ届く
- [ ] soft 範囲の負荷シナリオで final 欠落が 0 件である
- [ ] 既存の話者別直列処理（発話順）が維持される
