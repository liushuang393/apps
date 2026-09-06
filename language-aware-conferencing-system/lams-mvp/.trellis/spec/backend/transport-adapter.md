# TransportAdapter Delivery Contract

> Executable contract for subtitle / translated-audio delivery after Output Manager migration.

## 1. Scope / Trigger

- Trigger: delivery path changes, new sinks, Output Manager wiring, LiveKit data/audio publish
- Layers: `ai_pipeline.output_manager` ↔ `webrtc` (LiveKit) ↔ frontend data channel
- Forbidden: reintroducing `deliver_audio` / `deliver_subtitle` / `deliver_interim` / `deliver_event` or `OutputSinkTransportAdapter`

## 2. Signatures

```python
class TransportAdapter(Protocol):
    async def publish_audio(
        *,
        speaker_id: str,
        language: str,
        audio: bytes,
        recipient_ids: Sequence[str],
        generation_id: int | None,
    ) -> None: ...

    async def send_data(
        *,
        user_id: str,
        topic: str,
        payload: bytes,
    ) -> None: ...

def resolve_transport_adapter(adapter: TransportAdapter) -> TransportAdapter: ...

def build_default_output_manager(
    adapter: TransportAdapter,
    *,
    revision_authority: RevisionAuthority | None = None,
) -> DefaultOutputManager: ...
```

- Production adapter: `LiveKitOutputSink` (only `publish_audio` / `send_data`)
- Test adapter: `RecordingTransportAdapter`

## 3. Contracts

| Item | Contract |
|------|----------|
| Composition root | Always `build_default_output_manager(adapter)` from processor / orchestrator |
| Audio | WAV or PCM bytes; sink resamples to 48kHz; dedupe by object identity per language |
| Subtitle / QoS | `send_data` with topic `subtitle` or `qos`; payload is encoder-ready bytes |
| Failures | `send_data` / `publish_audio` raise; Output Manager isolates per recipient |
| Legacy OutputSink | Rejected at resolve time with `TypeError` |

## 4. Validation & Error Matrix

| Input | Result |
|-------|--------|
| Object with `publish_audio` + `send_data` | Accepted as-is |
| Object with only `deliver_*` | `TypeError` matching `TransportAdapter` |
| Empty `recipient_ids` or empty audio | No-op publish (no capture) |
| Unknown generation under GenerationGate | Skip capture |

## 5. Good / Base / Bad Cases

- **Good**: `DefaultOutputManager(adapter=LiveKitOutputSink(...))` via factory
- **Base**: `RecordingTransportAdapter` in unit tests; assert `adapter.audio` / `adapter.data`
- **Bad**: Calling sink `deliver_*`; wrapping with deleted `OutputSinkTransportAdapter`; asserting on `HybridOrchestrator._subtitle_message`

## 6. Tests Required

| Assertion | Where |
|-----------|--------|
| Factory accepts transport, rejects legacy | `tests/test_output_manager_factory.py` |
| LiveKit resample / dedupe / topics via publish/send | `tests/test_livekit_sink.py` |
| Orchestrator never bypasses Output Manager | `tests/test_output_manager_integration.py` |
| Subtitle payload fields via Final/Partial commands | `tests/test_orchestrator.py`, `tests/test_partial_subtitle.py` |
| Static ban on `_deliver_*_group` reintroduction | `tests/test_output_manager_integration.py` |

## 7. Wrong vs Correct

```python
# Wrong — legacy OutputSink dual interface
manager = DefaultOutputManager(adapter=OutputSinkTransportAdapter(sink))
await sink.deliver_audio(user_id, audio)

# Correct — single TransportAdapter seam
manager = build_default_output_manager(sink)  # sink implements publish_audio/send_data
await manager.handle(TranslatedAudioCommand(...))
```
