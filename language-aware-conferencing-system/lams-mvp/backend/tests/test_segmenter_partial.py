"""SpeechSegmenter の partial/final 出力（§P2 事件協議）の単体テスト。"""

from app.webrtc.segmenter import SegmentEvent, SpeechSegmenter

_FRAME_MS = 20
_SR = 16000
_FRAME_BYTES = _SR * _FRAME_MS // 1000 * 2  # int16 = 2byte/sample


def _speech_frames(n: int) -> bytes:
    """発話とみなされる n フレーム分の PCM（is_speech=常時True で使用）。"""
    return b"\x01\x02" * (_FRAME_BYTES // 2 * n)


def _always_speech(_frame: bytes) -> bool:
    return True


def _silence(_frame: bytes) -> bool:
    return False


def test_push_backward_compat_returns_finals_only() -> None:
    """partial 無効（既定）では push() は従来どおり final のみを返す。"""
    seg = SpeechSegmenter(
        sample_rate=_SR, frame_ms=_FRAME_MS, min_speech_ms=40, is_speech=_always_speech
    )
    # partial_ms 未指定 → partial は一切出ない。push は list[bytes]。
    out = seg.push(_speech_frames(10))
    assert out == []  # 無音・flush 前は final も無い
    tail = seg.flush()
    assert isinstance(tail, bytes) and len(tail) > 0


def test_push_events_emits_partials_at_interval() -> None:
    """partial_ms 間隔で暫定イベントを出し、flush で final を返す。"""
    seg = SpeechSegmenter(
        sample_rate=_SR,
        frame_ms=_FRAME_MS,
        min_speech_ms=40,  # 2 フレーム
        partial_ms=100,  # 5 フレーム毎に partial
        max_segment_ms=100000,
        is_speech=_always_speech,
    )
    events = seg.push_events(_speech_frames(10))
    partials = [e for e in events if e.is_partial]
    finals = [e for e in events if not e.is_partial]
    # 10 発話フレーム / 5 = 2 回の partial、final はまだ出ない。
    assert len(partials) == 2
    assert finals == []
    # partial は累積スナップショット（後の方が長い）。
    assert len(partials[1].pcm) > len(partials[0].pcm)
    tail = seg.flush()
    assert tail is not None


def test_partial_not_emitted_before_min_speech() -> None:
    """最小発話長未満では partial を出さない（誤検出抑制）。"""
    seg = SpeechSegmenter(
        sample_rate=_SR,
        frame_ms=_FRAME_MS,
        min_speech_ms=200,  # 10 フレーム
        partial_ms=40,  # 2 フレーム毎（早い）
        max_segment_ms=100000,
        is_speech=_always_speech,
    )
    events = seg.push_events(_speech_frames(6))  # 6 < 10 フレーム
    assert [e for e in events if e.is_partial] == []


def test_final_emitted_on_silence() -> None:
    """末尾無音で final を1件確定する（partial とは別種）。"""
    seg = SpeechSegmenter(
        sample_rate=_SR,
        frame_ms=_FRAME_MS,
        min_speech_ms=40,
        silence_ms=40,  # 2 無音フレームで確定
        partial_ms=100,
        max_segment_ms=100000,
        is_speech=_always_speech,
    )
    seg.push_events(_speech_frames(6))  # 発話
    seg._is_speech = _silence  # 以降無音
    events = seg.push_events(_speech_frames(3))  # 無音3フレーム → 確定
    finals = [e for e in events if not e.is_partial]
    assert len(finals) == 1
    assert isinstance(finals[0], SegmentEvent) and finals[0].is_partial is False
