# 08 — interim 字幕を revision 更新し final で消す

**What to build:** 認識中の暫定字幕が会議室に流れ、同一発話は revision 順に更新され、確定字幕到着時に暫定表示が消える。

**Blocked by:** 07 — イベントに schema_version を加算し未知版を安全に無視する

**Status:** ready-for-agent

- [ ] バックエンドが interim 字幕を送出する
- [ ] 同一発話の interim が revision 単調増加で更新される
- [ ] final 到着で対応する interim が削除される
- [ ] revision 逆転は無視される
- [ ] 過負荷時は interim を止め、final を優先できる（Phase 0 縮退と矛盾しない）
