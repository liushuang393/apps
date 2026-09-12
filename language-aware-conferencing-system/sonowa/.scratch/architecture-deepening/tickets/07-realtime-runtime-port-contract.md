# 07 — RealtimeRuntimePort の session/turn contract suite を本物にする

**What to build:** 短命 Runtime でも持続 Runtime でも、同じ会議の session 開閉と一発話 turn の完了・interrupt・fallback・close が同一契約として振る舞う。呼出側は内部 tracker や正しいメソッド順序の暗黙知なしに turn を実行できる。

**Blocked by:** 01 — QoE 縮退 evaluate 権威を型付きで確立する

**Status:** done

- [x] Port 公開契約が session lifecycle と turn execution を中心に再定義され、型付き session context／turn input／event（または turn result）を持つ
- [x] 共通 contract suite が短命・持続 factory の双方を通し、open 冪等・一 turn 完了・終端 event・interrupt 後旧出力抑止・close 冪等・型付き失敗を検証する
- [x] generation の発行と active 判定の owner が Port／registry 側で一貫している
- [x] reconnect 上限後の fallback が contract 上の degraded として一貫して返る
- [x] Provider 再接続中は読む主線への安全な縮退が QoE／契約イベントと矛盾しない
- [x] 既定動作は段階移行のため per-utterance を維持する

**Phase:** C  
**Spec:** issues/03-realtime-runtime-port-seam.md  
**Candidate:** 3
