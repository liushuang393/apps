# Implement order

## Stage 1: Delivery seam (tickets 1–4) — DONE + contract complete

1. `build_default_output_manager` を追加し、processor / orchestrator の fallback を同一配線に。
2. 本番経路は `adapter=LiveKitOutputSink`（TransportAdapter）直結。
3. テストを TransportAdapter 観測へ寄せる。
4. `deliver_*` を LiveKitOutputSink から削除済み。
5. `OutputSinkTransportAdapter` / `sink_adapter.py` 削除済み。`resolve_transport_adapter` は fail-fast。

**Success:** pytest output_manager / livekit_sink / orchestrator 系が緑。配線が1通り。

## Stage 4 note

- `_subtitle_message` 削除済み。字幕 payload 断言は `DefaultOutputManager` + Final/Partial commands へ移行。
- 発話収束は `utterance_convergence.py`。

## Remaining follow-ups

なし（残作業 A/B 完了）。

## Stage 2: Reading MT + QoS (tickets 5–6)

1. engine module へ `translate_text_simple` 本体を移す。
2. routes / OpenAIMTStage / orchestrator reading が engine を呼ぶ。
3. monitor 明示引数化。

**Success:** stages / qos / mode2 系テスト緑。

## Stage 3: Frontend (tickets 7–8)

1. useLiveKit DataReceived → decodeLiveEvent。
2. Preference 単一書き込み module。

**Success:** frontend type-check / lint 緑。

## Stage 4: Orchestrator cleanup (tickets 9–10)

1. dead helpers 削除 + テスト移行。
2. UtteranceConvergence 切り出し。

**Success:** orchestrator 系テスト緑。フル `./scripts/check.sh`。

## Change boundary

- 触る: backend ai_pipeline / webrtc / translate、frontend hooks / contracts / store / PreferencePanel
- 触らない: .env、Docker 構成の再設計、sokuji / simultaneous_interpretation
