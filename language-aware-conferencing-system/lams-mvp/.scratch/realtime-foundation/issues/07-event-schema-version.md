# 07 — イベントに schema_version を加算し未知版を安全に無視する

**What to build:** 字幕・QoS 等の配信イベントに schema_version と追跡用フィールドを加算しても、旧クライアントは既存フィールドだけで動き、新クライアントは未知 schema_version を無視して落ちない。

**Blocked by:** 04 — 聞く主線を Runtime Port 経由に移し既定挙動を維持する

**Status:** ready-for-agent

- [ ] 配信イベントに schema_version（現在 1）が付く
- [ ] 既存の字幕フィールド（id / seq / speaker 等）が残る（破壊的変更なし）
- [ ] フロントが未知 schema_version を無視する
- [ ] utterance_id / generation_id / runtime 等の加算フィールドを受け取れる
- [ ] 後方互換で確定字幕が表示される
