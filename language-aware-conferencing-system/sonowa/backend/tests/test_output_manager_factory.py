"""build_default_output_manager / resolve_transport_adapter の配線契約。"""

from __future__ import annotations

from collections.abc import Sequence

import pytest

from app.ai_pipeline.output_manager import (
    DefaultOutputManager,
    RecordingTransportAdapter,
    build_default_output_manager,
    resolve_transport_adapter,
)


class _LegacySink:
    """publish_audio を持たない旧 OutputSink（移行完了後は拒否対象）。"""

    async def deliver_audio(
        self,
        _user_id: str,
        _audio: bytes,
        *,
        generation_id: int | None = None,
    ) -> None:
        del generation_id

    async def deliver_subtitle(self, _user_id: str, _message: dict) -> None:
        return None


class _TransportSink:
    """TransportAdapter 契約を満たす Sink。"""

    async def publish_audio(
        self,
        *,
        speaker_id: str,
        language: str,
        audio: bytes,
        recipient_ids: Sequence[str],
        generation_id: int | None,
    ) -> None:
        del speaker_id, language, audio, recipient_ids, generation_id

    async def send_data(
        self,
        *,
        user_id: str,
        topic: str,
        payload: bytes,
    ) -> None:
        del user_id, topic, payload


def test_resolve_prefers_transport_adapter_directly() -> None:
    """TransportAdapter 実装は wrap せず直結する。"""
    sink = _TransportSink()
    assert resolve_transport_adapter(sink) is sink


def test_resolve_rejects_legacy_output_sink() -> None:
    """旧 deliver_* のみの Sink は TypeError で fail-fast する。"""
    with pytest.raises(TypeError, match="TransportAdapter"):
        resolve_transport_adapter(_LegacySink())  # type: ignore[arg-type]


def test_build_default_output_manager_uses_recording_adapter() -> None:
    """RecordingTransportAdapter を渡すと DefaultOutputManager が同一 adapter を保持する。"""
    adapter = RecordingTransportAdapter()
    manager = build_default_output_manager(adapter)
    assert isinstance(manager, DefaultOutputManager)
    assert manager._adapter is adapter  # noqa: SLF001 — 配線同一性の契約検証
