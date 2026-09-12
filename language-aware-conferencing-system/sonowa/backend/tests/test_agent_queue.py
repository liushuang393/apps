"""LiveKitAgent の lifecycle／配線テスト（取り込み政策は test_ingress_pipeline）。"""

import types

import pytest

from app.webrtc.agent import LiveKitAgent
from app.webrtc.ingress_pipeline import IngressPipeline


def _agent() -> LiveKitAgent:
    # rtc.Room を作らないようダミー room を注入（run しない限り rtc 依存なし）
    return LiveKitAgent("room-t", room=object())  # type: ignore[arg-type]


class _RaisingStream:
    """途中で例外を投げる AudioStream モック（異常切断を再現）。"""

    def __aiter__(self):
        return self

    async def __anext__(self):
        raise RuntimeError("connection dropped")


class _TailSegmenter:
    """push_events は何も返さず、flush で末尾セグメントを返すモック。"""

    def __init__(self, *args, **kwargs) -> None:  # noqa: ARG002
        pass

    def push_events(self, pcm: bytes) -> list:  # noqa: ARG002
        return []

    def flush(self) -> bytes:
        return b"tail"


@pytest.mark.asyncio
async def test_ingest_flushes_tail_on_abnormal_disconnect(monkeypatch):
    """異常切断でも IngressPipeline.end 経由で tail flush される（改善点 M3）。"""
    agent = _agent()
    handled: list[bytes] = []

    async def capture(speaker_id: str, seg: bytes) -> None:  # noqa: ARG001
        handled.append(seg)

    monkeypatch.setattr(agent, "_handle_segment", capture)
    # AudioStream / 既定 segmenter を差し替え（rtc・VAD 依存を排除）
    monkeypatch.setattr(
        "app.webrtc.agent.rtc.AudioStream", lambda *_a, **_k: _RaisingStream()
    )
    monkeypatch.setattr(
        "app.webrtc.ingress_pipeline.build_default_segmenter",
        lambda **_kw: _TailSegmenter(),
    )

    participant = types.SimpleNamespace(identity="sp")
    # 例外は finally で pipeline.end（tail flush）した後に再送出される。
    with pytest.raises(RuntimeError, match="connection dropped"):
        await agent._ingest(track=object(), participant=participant)

    assert handled == [b"tail"]
    assert "sp" not in agent._pipelines


@pytest.mark.asyncio
async def test_room_empty_leave_forgets_sequencer_state(monkeypatch):
    """改善点 M5: 最後の参加者退室で processor.forget_room が呼ばれる。"""
    agent = _agent()
    forgotten: list[str] = []
    monkeypatch.setattr(agent._processor, "forget_room", forgotten.append)

    async def fake_remove(room_id: str, pid: str) -> int:  # noqa: ARG001
        return 0  # 退室後の残り 0 = room 空

    async def fake_end(room_id: str) -> None:  # noqa: ARG001
        pass

    monkeypatch.setattr("app.webrtc.agent.room_manager.remove_participant", fake_remove)
    monkeypatch.setattr("app.webrtc.agent.end_session", fake_end)

    await agent._handle_participant_leave("last-user")
    assert forgotten == ["room-t"]


@pytest.mark.asyncio
async def test_leave_clears_partial_revision(monkeypatch):
    """退室で当該話者の revision authority state が破棄される（残留/再入室連番防止）。"""
    from app.ai_pipeline.revision_authority import (
        RevisionAuthority,
        RevisionStreamKey,
        RevisionUnknownError,
        StreamKind,
    )

    auth = RevisionAuthority()
    agent = LiveKitAgent("room-t", room=object(), revision_authority=auth)  # type: ignore[arg-type]
    left = agent._next_partial_token("u1")
    kept = agent._next_partial_token("u2")

    async def fake_remove(room_id: str, pid: str) -> int:  # noqa: ARG001
        return 1  # まだ残っている（room は空でない）

    monkeypatch.setattr("app.webrtc.agent.room_manager.remove_participant", fake_remove)

    await agent._handle_participant_leave("u1")
    with pytest.raises(RevisionUnknownError):
        auth.advance(
            "room-t",
            "u1",
            left.utterance_id,
            RevisionStreamKey(kind=StreamKind.PARTIAL_ASR),
        )
    next_kept = auth.advance(
        "room-t",
        "u2",
        kept.utterance_id,
        RevisionStreamKey(kind=StreamKind.PARTIAL_ASR),
    )
    assert next_kept.revision == kept.revision + 1


@pytest.mark.asyncio
async def test_leave_clears_qoe_and_releases_runtime(monkeypatch):
    """退室で QoE/過負荷状態を掃除し、Runtime 解放を呼ぶ。"""
    from app.ai_pipeline.qoe import QoEStateMachine

    agent = _agent()
    agent._qoe_by_speaker["u1"] = QoEStateMachine()
    agent._speaker_overloaded["u1"] = True

    async def on_final(pcm: bytes) -> None:  # noqa: ARG001
        return None

    async def on_partial(pcm: bytes) -> None:  # noqa: ARG001
        return None

    # 話者登録済み pipeline（退室で cancel されること）
    pipe = IngressPipeline.create_default(
        on_final=on_final,
        on_partial=on_partial,
        segmenter=_TailSegmenter(),
    )
    agent._pipelines["u1"] = pipe
    released: list[tuple[str, str]] = []

    async def fake_release(room_id: str, speaker_id: str) -> None:
        released.append((room_id, speaker_id))

    async def fake_remove(room_id: str, pid: str) -> int:  # noqa: ARG001
        return 1

    monkeypatch.setattr(agent._processor, "release_speaker", fake_release)
    monkeypatch.setattr("app.webrtc.agent.room_manager.remove_participant", fake_remove)

    await agent._handle_participant_leave("u1")
    assert "u1" not in agent._qoe_by_speaker
    assert "u1" not in agent._speaker_overloaded
    assert "u1" not in agent._provider_recovering
    assert "u1" not in agent._pipelines
    assert released == [("room-t", "u1")]
