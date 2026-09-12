# 02 — hard_limit / max_age での明示破棄と欠落観測

**What to build:** メモリ保護と鮮度のため、hard_limit または max_age 超過の確定発話だけを明示的に破棄し、欠落件数と理由を観測できるようにする（黙って捨てない）。

**Blocked by:** 01 — soft_limit 超過でも確定発話を落とさず Mode A を縮退する

**Status:** ready-for-agent

- [ ] hard_limit 超過時のみ最古 final を破棄する
- [ ] max_age 超過の final を破棄できる
- [ ] 破棄ごとに final_dropped（または同等）が増加し、理由付きで記録される
- [ ] soft 範囲では引き続き破棄ゼロである
- [ ] queue depth / age をスナップショットできる
