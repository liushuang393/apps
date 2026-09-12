"""チケット12: Ingress／Runtime interim を RevisionAuthority 経由にする配線テスト。

検証方針:
    - partial ASR と hearing transcript delta が同一 authority から token を取得する
    - Output Manager は revision を再採番せず authority 値を保持する
    - finalize 後／古い token の interim は配信前に拒否される
    - 退室で release され、二つの state owner 前提の assertion が不要になる
"""

from __future__ import annotations

from dataclasses import dataclass, field

import pytest

from app.ai_pipeline.orchestrator import HybridOrchestrator
from app.ai_pipeline.output_manager import (
    DefaultOutputManager,
    FinalSubtitleCommand,
    InterimSubtitleCommand,
    ListenerRef,
    RecordingTransportAdapter,
)
from app.ai_pipeline.revision_authority import (
    RevisionAuthority,
    RevisionFinalizedError,
    RevisionStreamKey,
    RevisionUnknownError,
    StreamKind,
)
from app.webrtc.agent import LiveKitAgent


def _listeners(*rows: tuple[str, str, bool, bool]) -> tuple[ListenerRef, ...]:
    """(user_id, lang, wants_audio, subtitle_enabled) から ListenerRef を組み立てる。"""
    return tuple(
        ListenerRef(
            user_id=user_id,
            target_language=lang,
            wants_audio=wants_audio,
            subtitle_enabled=subtitle_enabled,
        )
        for user_id, lang, wants_audio, subtitle_enabled in rows
    )


@dataclass
class _OmHarness:
    """共有 authority 付き Output Manager ハーネス。"""

    authority: RevisionAuthority = field(default_factory=RevisionAuthority)
    adapter: RecordingTransportAdapter = field(
        default_factory=RecordingTransportAdapter
    )
    manager: DefaultOutputManager = field(init=False)

    def __post_init__(self) -> None:
        self.manager = DefaultOutputManager(
            adapter=self.adapter,
            revision_authority=self.authority,
        )


@pytest.mark.asyncio
async def test_output_manager_preserves_authority_revision_without_renumber() -> None:
    """OM は authority 発行 revision を再採番せず wire へ載せる。"""
    h = _OmHarness()
    listeners = _listeners(("u1", "en", True, True))
    utterance_id = h.authority.begin("room-1", "spk", utterance_id="utt-1")
    stream = RevisionStreamKey(kind=StreamKind.HEARING_TRANSCRIPT, language="en")
    h.authority.advance("room-1", "spk", utterance_id, stream)
    h.authority.advance("room-1", "spk", utterance_id, stream)
    token = h.authority.advance("room-1", "spk", utterance_id, stream)

    report = await h.manager.handle(
        InterimSubtitleCommand(
            room_id="room-1",
            speaker_id="spk",
            subtitle_id=utterance_id,
            seq=1,
            target_language="en",
            text="hello",
            listeners=listeners,
            generation_id=1,
            revision=token.revision,
            stream_kind=StreamKind.HEARING_TRANSCRIPT.value,
        )
    )

    assert report.delivered_revisions == (3,)
    assert h.adapter.data[0][2]["revision"] == 3
    assert h.adapter.data[0][2]["type"] == "subtitle_interim"


@pytest.mark.asyncio
async def test_output_manager_rejects_finalized_and_stale_interim() -> None:
    """finalize 後および古い token の interim は配信前に拒否される。"""
    h = _OmHarness()
    listeners = _listeners(("u1", "en", True, True))
    utterance_id = h.authority.begin("room-1", "spk", utterance_id="utt-1")
    stream = RevisionStreamKey(kind=StreamKind.HEARING_TRANSCRIPT, language="en")
    stale = h.authority.advance("room-1", "spk", utterance_id, stream)
    latest = h.authority.advance("room-1", "spk", utterance_id, stream)

    stale_report = await h.manager.handle(
        InterimSubtitleCommand(
            room_id="room-1",
            speaker_id="spk",
            subtitle_id=utterance_id,
            seq=1,
            target_language="en",
            text="old",
            listeners=listeners,
            revision=stale.revision,
            stream_kind=StreamKind.HEARING_TRANSCRIPT.value,
        )
    )
    assert stale_report.delivered_revisions == ()
    assert any(
        s.reason == "stale_or_finalized_revision" for s in stale_report.suppressed
    )
    assert h.adapter.data == []

    ok_report = await h.manager.handle(
        InterimSubtitleCommand(
            room_id="room-1",
            speaker_id="spk",
            subtitle_id=utterance_id,
            seq=1,
            target_language="en",
            text="new",
            listeners=listeners,
            revision=latest.revision,
            stream_kind=StreamKind.HEARING_TRANSCRIPT.value,
        )
    )
    assert ok_report.delivered_revisions == (2,)

    await h.manager.handle(
        FinalSubtitleCommand(
            room_id="room-1",
            speaker_id="spk",
            subtitle_id=utterance_id,
            seq=1,
            original_text="hello",
            source_language="ja",
            target_language="en",
            translated_text="hello",
            mainline="hearing",
            listeners=listeners,
        )
    )
    h.adapter.data.clear()

    with pytest.raises(RevisionFinalizedError):
        h.authority.advance("room-1", "spk", utterance_id, stream)

    delayed = await h.manager.handle(
        InterimSubtitleCommand(
            room_id="room-1",
            speaker_id="spk",
            subtitle_id=utterance_id,
            seq=2,
            target_language="en",
            text="late",
            listeners=listeners,
            revision=latest.revision,
            stream_kind=StreamKind.HEARING_TRANSCRIPT.value,
        )
    )
    assert delayed.delivered_revisions == ()
    assert h.adapter.data == []


def test_orchestrator_and_partial_share_same_authority_monotone() -> None:
    """Runtime hearing delta と Ingress partial が同一 authority から単調 token を得る。"""
    auth = RevisionAuthority()
    orch = HybridOrchestrator(revision_authority=auth)

    utterance_id = auth.begin("room-1", "spk", utterance_id="utt-shared")
    partial_stream = RevisionStreamKey(kind=StreamKind.PARTIAL_ASR)
    hearing_stream = RevisionStreamKey(
        kind=StreamKind.HEARING_TRANSCRIPT, language="en"
    )

    p1 = auth.advance("room-1", "spk", utterance_id, partial_stream)
    h1 = orch._interim_message(
        subtitle_id=utterance_id,
        target_language="en",
        seq=1,
        room_id="room-1",
        speaker_id="spk",
        text="hel",
        generation_id=1,
    )
    p2 = auth.advance("room-1", "spk", utterance_id, partial_stream)
    h2 = orch._interim_message(
        subtitle_id=utterance_id,
        target_language="en",
        seq=1,
        room_id="room-1",
        speaker_id="spk",
        text="hello",
        generation_id=1,
    )

    assert (p1.revision, p2.revision) == (1, 2)
    assert (h1["revision"], h2["revision"]) == (1, 2)
    assert auth.accept(p2) is True
    # hearing 最新のみ受理。partial と hearing は独立 stream。
    assert auth.snapshot().stream_count == 2
    del hearing_stream  # 明示: 共有 counter ではない


@pytest.mark.asyncio
async def test_alternating_producers_finalize_and_reject_via_om() -> None:
    """producer 交互更新 → finalize → 遅延 token 拒否を OM 経由で end-to-end 検証する。"""
    h = _OmHarness()
    listeners = _listeners(("u1", "en", True, True), ("u2", "ja", True, True))
    utterance_id = h.authority.begin("room-1", "spk", utterance_id="utt-1")
    partial = RevisionStreamKey(kind=StreamKind.PARTIAL_ASR)
    hearing_en = RevisionStreamKey(kind=StreamKind.HEARING_TRANSCRIPT, language="en")
    hearing_ja = RevisionStreamKey(kind=StreamKind.HEARING_TRANSCRIPT, language="ja")

    # 交互に advance したあと、古い token は拒否・各 stream の最新のみ配信
    t_p1 = h.authority.advance("room-1", "spk", utterance_id, partial)
    t_en1 = h.authority.advance("room-1", "spk", utterance_id, hearing_en)
    t_ja1 = h.authority.advance("room-1", "spk", utterance_id, hearing_ja)
    t_p2 = h.authority.advance("room-1", "spk", utterance_id, partial)
    t_en2 = h.authority.advance("room-1", "spk", utterance_id, hearing_en)

    stale_cases = (
        (t_p1, "en", StreamKind.PARTIAL_ASR.value, "p1"),
        (t_en1, "en", StreamKind.HEARING_TRANSCRIPT.value, "en1"),
    )
    for token, lang, kind, text in stale_cases:
        report = await h.manager.handle(
            InterimSubtitleCommand(
                room_id="room-1",
                speaker_id="spk",
                subtitle_id=utterance_id,
                seq=1,
                target_language=lang,
                text=text,
                listeners=listeners,
                revision=token.revision,
                stream_kind=kind,
            )
        )
        assert report.delivered_revisions == ()

    latest_cases = (
        (t_ja1, "ja", StreamKind.HEARING_TRANSCRIPT.value, "ja1"),
        (t_p2, "en", StreamKind.PARTIAL_ASR.value, "p2"),
        (t_en2, "en", StreamKind.HEARING_TRANSCRIPT.value, "en2"),
    )
    for token, lang, kind, text in latest_cases:
        report = await h.manager.handle(
            InterimSubtitleCommand(
                room_id="room-1",
                speaker_id="spk",
                subtitle_id=utterance_id,
                seq=1,
                target_language=lang,
                text=text,
                listeners=listeners,
                revision=token.revision,
                stream_kind=kind,
            )
        )
        assert report.delivered_revisions == (token.revision,)

    await h.manager.handle(
        FinalSubtitleCommand(
            room_id="room-1",
            speaker_id="spk",
            subtitle_id=utterance_id,
            seq=1,
            original_text="done",
            source_language="ja",
            target_language="en",
            translated_text="done",
            mainline="hearing",
            listeners=listeners,
        )
    )
    # FinalSubtitleCommand は target_language の hearing stream を finalize する
    with pytest.raises(RevisionFinalizedError):
        h.authority.advance("room-1", "spk", utterance_id, hearing_en)
    # 他言語 hearing と partial は独立して継続可能
    ja_next = h.authority.advance("room-1", "spk", utterance_id, hearing_ja)
    assert ja_next.revision == 2
    p_next = h.authority.advance("room-1", "spk", utterance_id, partial)
    assert p_next.revision == 3


def test_agent_partial_token_comes_from_authority() -> None:
    """Agent の partial 採番はローカル counter ではなく authority token を使う。"""
    auth = RevisionAuthority()
    agent = LiveKitAgent("room-t", room=object(), revision_authority=auth)  # type: ignore[arg-type]

    assert "_partial_rev" not in agent.__dict__

    t1 = agent._next_partial_token("spk-1")
    t2 = agent._next_partial_token("spk-1")

    assert t1.utterance_id == t2.utterance_id
    assert (t1.revision, t2.revision) == (1, 2)
    assert t1.stream_key.kind is StreamKind.PARTIAL_ASR
    assert auth.snapshot().stream_count == 1


@pytest.mark.asyncio
async def test_leave_releases_authority_not_local_partial_map(monkeypatch) -> None:
    """退室で authority の話者 state が解放され、再入室は新 stream になる。"""
    auth = RevisionAuthority()
    agent = LiveKitAgent("room-t", room=object(), revision_authority=auth)  # type: ignore[arg-type]
    first = agent._next_partial_token("u1")
    kept = agent._next_partial_token("u2")

    async def fake_remove(room_id: str, pid: str) -> int:  # noqa: ARG001
        return 1

    async def fake_release(room_id: str, speaker_id: str) -> None:  # noqa: ARG001
        return None

    monkeypatch.setattr("app.webrtc.agent.room_manager.remove_participant", fake_remove)
    monkeypatch.setattr(agent._processor, "release_speaker", fake_release)

    await agent._handle_participant_leave("u1")

    with pytest.raises(RevisionUnknownError):
        auth.advance(
            "room-t",
            "u1",
            first.utterance_id,
            RevisionStreamKey(kind=StreamKind.PARTIAL_ASR),
        )
    next_kept = auth.advance(
        "room-t",
        "u2",
        kept.utterance_id,
        RevisionStreamKey(kind=StreamKind.PARTIAL_ASR),
    )
    assert next_kept.revision == kept.revision + 1

    rejoined = agent._next_partial_token("u1")
    assert rejoined.revision == 1
    assert rejoined.utterance_id != first.utterance_id


def test_orchestrator_finish_interim_finalizes_authority_stream() -> None:
    """確定後の finish は authority finalize であり、遅延 advance を拒否する。"""
    auth = RevisionAuthority()
    orch = HybridOrchestrator(revision_authority=auth)
    msg = orch._interim_message(
        subtitle_id="utt-1",
        target_language="en",
        seq=1,
        room_id="room-1",
        speaker_id="spk",
        text="hel",
        generation_id=1,
    )
    assert msg["revision"] == 1

    orch._finish_interim(
        room_id="room-1",
        speaker_id="spk",
        subtitle_id="utt-1",
        target_language="en",
    )

    with pytest.raises(RevisionFinalizedError):
        auth.advance(
            "room-1",
            "spk",
            "utt-1",
            RevisionStreamKey(kind=StreamKind.HEARING_TRANSCRIPT, language="en"),
        )


@pytest.mark.asyncio
async def test_orchestrator_release_speaker_clears_revision_authority() -> None:
    """orchestrator.release_speaker が revision authority も解放する。"""
    auth = RevisionAuthority()

    class _Reg:
        async def release_speaker(self, _room_id: str, _speaker_id: str) -> None:
            return None

        async def release_room(self, _room_id: str) -> None:
            return None

        def get_or_create(self, context: object) -> object:  # noqa: ARG002
            raise AssertionError("未使用")

        def interrupt_speaker(
            self,
            _room_id: str,
            _speaker_id: str,
            _generation_id: int | None = None,
        ) -> None:
            return None

    orch = HybridOrchestrator(runtime_registry=_Reg(), revision_authority=auth)  # type: ignore[arg-type]
    orch._interim_message(
        subtitle_id="utt-1",
        target_language="en",
        seq=1,
        room_id="room-1",
        speaker_id="spk",
        text="x",
        generation_id=1,
    )
    await orch.release_speaker("room-1", "spk")
    assert auth.snapshot().speaker_count == 0
