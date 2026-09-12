# 01 — QoE 縮退 evaluate 権威を型付きで確立する

**What to build:** 会議品質の観測値を渡すと、聞く主線・読む主線・暫定字幕の可否と理由コードが一つの決定結果として返る。同じ入力系列なら常に同じ縮退優先順位（Queue → Provider → AI hearing → 受聴者 Media）が再現される。

**Blocked by:** None — can start immediately

**Status:** done

- [x] Media / AI / Queue / Provider の型付き input を一度に受け、状態・主要理由・補助理由・主線可否・partial 可否・changed を含む decision を返す evaluate が公開されている
- [x] 未計測値は正常値ではなく unknown として扱われ、単独劣化・複合劣化の優先順位が決定論的に検証できる
- [x] 時計を注入でき、ヒステリシス／cooldown の骨組みを後続チケットが拡張できる
- [x] decision と warning が区別され、会議本文・Token・API Key が input/decision に含まれない
- [x] 仕様 `issues/02` の提案シーム（単一 evaluate）に沿い、内部 state 変数ではなく観測系列→decision を検証するテストがある

**Phase:** A  
**Spec:** issues/02-qoe-single-authority.md  
**Candidate:** 2
