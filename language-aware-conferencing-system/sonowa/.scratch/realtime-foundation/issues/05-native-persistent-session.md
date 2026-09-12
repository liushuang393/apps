# 05 — Native 持続セッションで発話ごとの再接続をやめる

**What to build:** `native_persistent` 有効時、同一セッションキー（会議室・話者・目標言語・provider）では Provider 接続を維持したまま連続発話を処理し、切断時は再接続または安全な切り戻しができる。

**Blocked by:** 04 — 聞く主線を Runtime Port 経由に移し既定挙動を維持する

**Status:** ready-for-agent

- [ ] 持続モードで連続発話しても接続を発話ごとに作り直さない
- [ ] Provider 切断後に自動再接続を試みる
- [ ] 再接続上限超過時は短命接続相当へ切り戻り、字幕（読む主線）は継続する
- [ ] 音声取り込みループを Provider 待ちで塞がない
- [ ] 既定 per_utterance の挙動は変えない
