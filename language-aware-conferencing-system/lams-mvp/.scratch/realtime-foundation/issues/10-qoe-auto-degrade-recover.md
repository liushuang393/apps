# 10 — Media+AI+Queue の QoE で翻訳音声を自動縮退・回復する

**What to build:** packet loss・hearing P95・キュー過負荷・Provider 障害をまとめて判定し、翻訳音声を自動停止して原声+字幕へ縮退し、条件回復後に安全に戻せる。

**Blocked by:** 02 — hard_limit / max_age での明示破棄と欠落観測; 03 — 過負荷・縮退状態を会議室 UI で区別表示する; 08 — interim 字幕を revision 更新し final で消す; 09 — WebRTC Stats を収集して品質判定に渡す

**Status:** ready-for-agent

- [ ] packet loss が閾値超過で翻訳音声が止まり、原声+字幕になる
- [ ] hearing P95 / キュー過負荷 / Provider 回復中の縮退が一つの状態機械で整合する
- [ ] 条件解除とクールダウン後に healthy へ復帰できる
- [ ] ヒステリシスまたはクールダウンによりフラッピングしない
- [ ] degraded / interrupted が UI 上で区別または少なくとも誤表示しない
- [ ] 正式記録（読む主線）は縮退中も基準として維持される
