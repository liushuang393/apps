# Backend Development Guidelines

> Code-spec contracts for backend delivery, pipeline, and MT seams.

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Transport Adapter](./transport-adapter.md) | Output Manager ↔ LiveKit delivery contract | Active |

## Pre-Development Checklist

- [ ] If touching subtitle/audio delivery, read [transport-adapter.md](./transport-adapter.md)
- [ ] Do not reintroduce `deliver_*` or `OutputSinkTransportAdapter`
- [ ] Wire Output Manager only through `build_default_output_manager`
- [ ] Prefer `RecordingTransportAdapter` in tests over custom deliver_* fakes
