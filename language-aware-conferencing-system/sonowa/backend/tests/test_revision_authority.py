"""暫定字幕 RevisionAuthority の lifecycle 契約テスト。

方針: private counter ではなく、発行 token・finalize 後拒否・release 後の新 stream を検証する。
本文（字幕テキスト）は authority に渡さず、snapshot にも載せない。
"""

from __future__ import annotations

import pytest

from app.ai_pipeline.revision_authority import (
    RevisionAuthority,
    RevisionFinalizedError,
    RevisionStreamKey,
    RevisionUnknownError,
    StreamKind,
)


def _hearing(lang: str) -> RevisionStreamKey:
    """聞く主線 transcript delta 用の stream key。"""
    return RevisionStreamKey(kind=StreamKind.HEARING_TRANSCRIPT, language=lang)


def _partial() -> RevisionStreamKey:
    """partial ASR 用の stream key（言語非依存）。"""
    return RevisionStreamKey(kind=StreamKind.PARTIAL_ASR)


def test_begin_assigns_stable_utterance_when_empty() -> None:
    """空の temporary id を恒久 key にせず、begin が安定した utterance identity を返す。"""
    auth = RevisionAuthority()

    first = auth.begin("room-1", "spk-1", utterance_id="")
    second = auth.begin("room-1", "spk-1", utterance_id=None)

    assert first
    assert second
    assert first != ""
    assert second != ""
    assert first != second


def test_begin_keeps_provided_utterance_id() -> None:
    """呼び出し側が安定 id を渡した場合はそのまま採用する。"""
    auth = RevisionAuthority()

    utterance_id = auth.begin("room-1", "spk-1", utterance_id="utt-fixed")

    assert utterance_id == "utt-fixed"


def test_advance_is_monotonic_for_same_stream() -> None:
    """同一 utterance／stream の advance は単調増加する。"""
    auth = RevisionAuthority()
    utterance_id = auth.begin("room-1", "spk-1", utterance_id="utt-1")
    stream = _hearing("en")

    first = auth.advance("room-1", "spk-1", utterance_id, stream)
    second = auth.advance("room-1", "spk-1", utterance_id, stream)

    assert first.revision == 1
    assert second.revision == 2
    assert first.utterance_id == utterance_id
    assert second.stream_key == stream


def test_streams_are_independent_by_key() -> None:
    """stream key が異なれば revision は独立して進む。"""
    auth = RevisionAuthority()
    utterance_id = auth.begin("room-1", "spk-1", utterance_id="utt-1")

    en_a = auth.advance("room-1", "spk-1", utterance_id, _hearing("en"))
    ja_a = auth.advance("room-1", "spk-1", utterance_id, _hearing("ja"))
    en_b = auth.advance("room-1", "spk-1", utterance_id, _hearing("en"))

    assert (en_a.revision, ja_a.revision, en_b.revision) == (1, 1, 2)


def test_shared_stream_key_keeps_single_monotonic_sequence() -> None:
    """partial ASR と hearing が同じ stream key を共有すれば一つの単調列になる。"""
    auth = RevisionAuthority()
    utterance_id = auth.begin("room-1", "spk-1", utterance_id="utt-1")
    shared = RevisionStreamKey(kind=StreamKind.PARTIAL_ASR, language="src")

    a = auth.advance("room-1", "spk-1", utterance_id, shared)
    b = auth.advance("room-1", "spk-1", utterance_id, shared)
    c = auth.advance("room-1", "spk-1", utterance_id, shared)

    assert (a.revision, b.revision, c.revision) == (1, 2, 3)


def test_producer_alternating_on_separate_streams() -> None:
    """producer 交互更新でも種別が異なれば互いに抑止しない。"""
    auth = RevisionAuthority()
    utterance_id = auth.begin("room-1", "spk-1", utterance_id="utt-1")

    p1 = auth.advance("room-1", "spk-1", utterance_id, _partial())
    h1 = auth.advance("room-1", "spk-1", utterance_id, _hearing("en"))
    p2 = auth.advance("room-1", "spk-1", utterance_id, _partial())
    h2 = auth.advance("room-1", "spk-1", utterance_id, _hearing("en"))

    assert (p1.revision, p2.revision) == (1, 2)
    assert (h1.revision, h2.revision) == (1, 2)


def test_finalize_rejects_subsequent_advance() -> None:
    """finalize 後の advance は拒否され、遅延 interim を発行しない。"""
    auth = RevisionAuthority()
    utterance_id = auth.begin("room-1", "spk-1", utterance_id="utt-1")
    stream = _hearing("en")
    token = auth.advance("room-1", "spk-1", utterance_id, stream)

    auth.finalize("room-1", "spk-1", utterance_id, stream)

    with pytest.raises(RevisionFinalizedError):
        auth.advance("room-1", "spk-1", utterance_id, stream)
    assert auth.accept(token) is False


def test_finalize_one_stream_does_not_block_another() -> None:
    """一言語の finalize は別 stream の更新を止めない。"""
    auth = RevisionAuthority()
    utterance_id = auth.begin("room-1", "spk-1", utterance_id="utt-1")
    auth.advance("room-1", "spk-1", utterance_id, _hearing("en"))
    auth.finalize("room-1", "spk-1", utterance_id, _hearing("en"))

    other = auth.advance("room-1", "spk-1", utterance_id, _hearing("ja"))

    assert other.revision == 1
    assert auth.accept(other) is True


def test_accept_rejects_stale_revision() -> None:
    """同一 stream で新しい revision が出た後、古い token は拒否される。"""
    auth = RevisionAuthority()
    utterance_id = auth.begin("room-1", "spk-1", utterance_id="utt-1")
    stream = _partial()
    stale = auth.advance("room-1", "spk-1", utterance_id, stream)
    latest = auth.advance("room-1", "spk-1", utterance_id, stream)

    assert auth.accept(stale) is False
    assert auth.accept(latest) is True


def test_release_utterance_allows_new_stream() -> None:
    """cancel／release 後は同じ utterance id でも新 stream として revision が再開する。"""
    auth = RevisionAuthority()
    utterance_id = auth.begin("room-1", "spk-1", utterance_id="utt-1")
    stream = _partial()
    auth.advance("room-1", "spk-1", utterance_id, stream)
    auth.advance("room-1", "spk-1", utterance_id, stream)

    auth.release_utterance("room-1", "spk-1", utterance_id)
    auth.begin("room-1", "spk-1", utterance_id=utterance_id)
    restarted = auth.advance("room-1", "spk-1", utterance_id, stream)

    assert restarted.revision == 1


def test_release_speaker_clears_only_that_speaker() -> None:
    """退室 cleanup は当該話者だけを解放し、他話者の stream は残す。"""
    auth = RevisionAuthority()
    left = auth.begin("room-1", "spk-left", utterance_id="utt-l")
    kept = auth.begin("room-1", "spk-kept", utterance_id="utt-k")
    auth.advance("room-1", "spk-left", left, _partial())
    kept_token = auth.advance("room-1", "spk-kept", kept, _partial())

    auth.release_speaker("room-1", "spk-left")

    with pytest.raises(RevisionUnknownError):
        auth.advance("room-1", "spk-left", left, _partial())
    assert auth.accept(kept_token) is True
    next_kept = auth.advance("room-1", "spk-kept", kept, _partial())
    assert next_kept.revision == 2


def test_release_room_clears_all_state() -> None:
    """room 終了で当該 room の state が残らない。"""
    auth = RevisionAuthority()
    u1 = auth.begin("room-1", "spk-1", utterance_id="utt-1")
    u2 = auth.begin("room-2", "spk-1", utterance_id="utt-2")
    auth.advance("room-1", "spk-1", u1, _partial())
    other = auth.advance("room-2", "spk-1", u2, _partial())

    auth.release_room("room-1")

    snap = auth.snapshot()
    assert snap.stream_count == 1
    assert auth.accept(other) is True
    with pytest.raises(RevisionUnknownError):
        auth.advance("room-1", "spk-1", u1, _partial())


def test_rejoin_starts_fresh_stream() -> None:
    """再入室後は前回接続の revision を引き継がず 1 から開始する。"""
    auth = RevisionAuthority()
    utterance_id = auth.begin("room-1", "spk-1", utterance_id="utt-1")
    auth.advance("room-1", "spk-1", utterance_id, _partial())
    auth.advance("room-1", "spk-1", utterance_id, _partial())
    auth.release_speaker("room-1", "spk-1")

    rejoined = auth.begin("room-1", "spk-1", utterance_id="utt-2")
    token = auth.advance("room-1", "spk-1", rejoined, _partial())

    assert token.revision == 1


def test_snapshot_exposes_counts_without_text() -> None:
    """authority の state 数を本文なし snapshot で観測できる。"""
    auth = RevisionAuthority()
    u1 = auth.begin("room-a", "spk-1", utterance_id="utt-1")
    u2 = auth.begin("room-a", "spk-2", utterance_id="utt-2")
    auth.advance("room-a", "spk-1", u1, _partial())
    auth.advance("room-a", "spk-1", u1, _hearing("en"))
    auth.advance("room-a", "spk-2", u2, _partial())
    auth.finalize("room-a", "spk-1", u1, _partial())

    snap = auth.snapshot()
    payload = snap.__dict__

    assert snap.room_count == 1
    assert snap.speaker_count == 2
    assert snap.utterance_count == 2
    assert snap.stream_count == 3
    assert snap.finalized_stream_count == 1
    assert "text" not in payload
    assert "original_text" not in payload
    assert all(not isinstance(v, str) for v in payload.values())


def test_advance_without_begin_is_rejected() -> None:
    """begin 前の advance は未知 utterance として拒否する。"""
    auth = RevisionAuthority()

    with pytest.raises(RevisionUnknownError):
        auth.advance("room-1", "spk-1", "missing", _partial())


def test_revision_token_aligns_with_event_contract_field() -> None:
    """発行 revision は event 契約の integer フィールドへそのまま載せられる。"""
    from app.ai_pipeline.events import envelope_event

    auth = RevisionAuthority()
    utterance_id = auth.begin("room-1", "spk-1", utterance_id="utt-1")
    token = auth.advance("room-1", "spk-1", utterance_id, _hearing("en"))

    event = envelope_event(
        {
            "type": "subtitle_interim",
            "id": utterance_id,
            "seq": 1,
            "text": "hello",
            "is_final": False,
        },
        room_id=token.room_id,
        speaker_id=token.speaker_id,
        utterance_id=token.utterance_id,
        sequence_id=1,
        revision=token.revision,
    )

    assert event["revision"] is token.revision
    assert isinstance(event["revision"], int)
    assert event["revision"] == 1
