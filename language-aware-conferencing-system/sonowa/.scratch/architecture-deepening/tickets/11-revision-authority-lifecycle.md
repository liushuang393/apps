# 11 — 暫定字幕 RevisionAuthority を単一 lifecycle にする

**What to build:** begin／advance／finalize／release を持つ単一の revision 権威により、同一 utterance／stream の暫定字幕が単調増加し、確定後の遅延 interim が拒否され、退室・room 終了で状態が残らない。クライアントの逆転 guard は防御策として残るが、正しさの責任はサーバ権威にある。

**Blocked by:** 01 — QoE 縮退 evaluate 権威を型付きで確立する; 04 — サーバ・クライアント共有の型付きイベント契約を往復検証する

**Status:** done

- [x] RevisionAuthority が room／speaker／utterance／stream key ごとの単調増加を所有する
- [x] begin／advance／finalize／release の lifecycle が公開され、単調増加・複数 stream 独立・finalize 後拒否・release 後新 stream・再入室が検証できる
- [x] partial ASR と hearing transcript delta の共有／分離が stream key 種別で明示される
- [x] 空の temporary subtitle id を恒久 key にせず、発話開始時に安定した utterance identity を割り当てる
- [x] authority の state 数を本文なし snapshot で観測できる
- [x] event 契約の revision フィールドは authority 発行値を上書きしない前提と整合する

**Phase:** D  
**Spec:** issues/06-interim-revision-authority.md  
**Candidate:** 6
