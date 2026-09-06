# Design: Architecture deepening

## Vocabulary

module / interface / implementation / depth / seam / adapter / leverage / locality。
ドメイン語: 読む主線、hearing、字幕、翻訳音声、確定発話、QoS、参加者設定。

## Test seams（実装前に固定）

1. **TransportAdapter** — `publish_audio` / `send_data` の観測（RecordingTransportAdapter / LiveKitOutputSink）
2. **TextTranslationEngine.translate** — キャッシュ・用語・TM を含む読む主線結果
3. **decodeLiveEvent** — DataReceived 相当の fixture → LiveEvent
4. **PreferenceCoordinator.apply** — store 状態 + attribute payload の同時更新
5. **UtteranceConvergence**（後段）— fork/join/fallback の Observable 結果

## Module decisions

### A. Delivery（tickets 1–4）

- 外部 seam: `TransportAdapter` のみ。
- `LiveKitOutputSink` は TransportAdapter adapter。`deliver_*` は expand 期間併存後に contract。
- composition root: `build_default_output_manager(adapter: TransportAdapter)` を processor / orchestrator が共有。
- `OutputSinkTransportAdapter` は旧 OutputSink のみのテスト用に残すか、呼び出しゼロなら削除。

### B. Reading MT（tickets 5–6）

- TextTranslationEngine が deep module。routes は HTTP adapter。
- QoS monitor は明示引数。ContextVar はテスト shim。

### C. Frontend（tickets 7–8）

- Data channel ingress → decodeLiveEvent。
- Preference 変更 → 単一 interface（store + attributes）。

### D. Orchestrator（tickets 9–10）

- dead helpers 削除後、収束ロジックを UtteranceConvergence へ。
- HybridOrchestrator は command 組み立て + delegate。

## Dependency categories

- Delivery: ports & adapters（LiveKit / RecordingTransportAdapter）
- MT / QoS / decodeLiveEvent / preference: in-process または local-substitutable
