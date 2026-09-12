# realtime-foundation — チケット一覧

出典: `docs/リアルタイム基盤改善_設計書.md`（Phase 0〜2）

## 依存グラフ

```text
01 soft_limit 縮退 ──┬──► 02 hard/max_age 観測 ──┐
                     └──► 03 degraded UI ─────────┼──► 09 Stats ──┐
                                                  │              ├──► 10 QoE 自動縮退
04 Runtime Port ──┬──► 05 持続セッション ──► 06 barge-in         │
                  └──► 07 schema_version ──► 08 interim ─────────┘
```

## Frontier（すぐ着手可）

- `01` soft_limit 超過でも確定発話を落とさず Mode A を縮退する
- `04` 聞く主線を Runtime Port 経由に移し既定挙動を維持する

## ファイル

| # | ファイル |
|---|----------|
| 01 | `issues/01-soft-limit-no-drop-degrade.md` |
| 02 | `issues/02-hard-limit-max-age-observability.md` |
| 03 | `issues/03-overload-degraded-ui.md` |
| 04 | `issues/04-runtime-port-per-utterance.md` |
| 05 | `issues/05-native-persistent-session.md` |
| 06 | `issues/06-generation-barge-in.md` |
| 07 | `issues/07-event-schema-version.md` |
| 08 | `issues/08-interim-revision-subtitles.md` |
| 09 | `issues/09-webrtc-stats-collection.md` |
| 10 | `issues/10-qoe-auto-degrade-recover.md` |
