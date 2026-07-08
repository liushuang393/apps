"""
SegmentProcessor（Phase 3 C1-5）の単体テスト。

言語検出・orchestrator・save_subtitle をフェイク/monkeypatch で差し替え、rtc 非依存で
「WAV 化 → 検出 → 採番/重複排除 → 2 主線駆動 → 永続化」の各分岐を検証する。
"""

import pytest

from app.ai_pipeline.orchestrator import OrchestrationResult
from app.rooms.manager import ParticipantPreference
from app.webrtc import processor as processor_mod
from app.webrtc.persistence import MeetingConfig, SubtitleSequencer
from app.webrtc.processor import SegmentProcessor

# 16kHz・約 0.3 秒分のダミー PCM（中身は検証に無関係なので無音で良い）。
_PCM = b"\x10\x00" * 4800


class _RecordingOrchestrator:
    """orchestrate 呼び出しの kwargs を記録し、固定の翻訳結果を返すフェイク。"""

    def __init__(self) -> None:
        self.calls: list[dict] = []

    async def orchestrate(self, **kwargs) -> OrchestrationResult:
        self.calls.append(kwargs)
        return OrchestrationResult(translations={kwargs["source_language"]: "x"})


def _participants() -> dict[str, ParticipantPreference]:
    """話者 1 名＋翻訳音声受聴者 1 名の最小構成。"""
    return {
        "spk": ParticipantPreference(
            user_id="spk", display_name="S", native_language="ja"
        ),
        "lis": ParticipantPreference(
            user_id="lis",
            display_name="L",
            native_language="en",
            audio_mode="translated",
        ),
    }


def _make(
    detect, monkeypatch
) -> tuple[SegmentProcessor, _RecordingOrchestrator, list, list]:
    """検出関数を注入し save_subtitle を捕捉する Processor を組み立てる。"""
    saved: list[dict] = []
    originals: list[dict] = []

    async def fake_save(**kwargs) -> None:
        saved.append(kwargs)

    async def fake_store_original(subtitle_id: str, original_text: str, source_language: str) -> None:
        originals.append(
            {
                "subtitle_id": subtitle_id,
                "original_text": original_text,
                "source_language": source_language,
            }
        )

    monkeypatch.setattr(processor_mod, "save_transcript_segment", fake_save)
    monkeypatch.setattr(processor_mod.subtitle_cache, "store_original", fake_store_original)
    orch = _RecordingOrchestrator()
    proc = SegmentProcessor(
        orchestrator=orch, sequencer=SubtitleSequencer(), detect_fn=detect
    )
    return proc, orch, saved, originals


def _sink_factory(captured: list):
    """user_language を記録するだけの sink_factory を返す。"""

    def factory(user_language: dict[str, str], _speaker_id: str) -> object:
        captured.append(user_language)
        return object()

    return factory


@pytest.mark.asyncio
async def test_empty_pcm_returns_none(monkeypatch) -> None:
    async def detect(_wav: bytes, _hint: str) -> tuple[str, str]:
        return ("text", "ja")

    proc, orch, saved, _originals = _make(detect, monkeypatch)
    result = await proc.process(
        room_id="r",
        speaker_id="spk",
        pcm16=b"",
        speaker_lang_hint="ja",
        participants=_participants(),
        sink_factory=_sink_factory([]),
        config=MeetingConfig(),
    )
    assert result is None
    assert orch.calls == [] and saved == []


@pytest.mark.asyncio
async def test_empty_recognition_returns_none(monkeypatch) -> None:
    async def detect(_wav: bytes, _hint: str) -> tuple[str, str]:
        return ("", "ja")

    proc, orch, saved, _originals = _make(detect, monkeypatch)
    result = await proc.process(
        room_id="r",
        speaker_id="spk",
        pcm16=_PCM,
        speaker_lang_hint="ja",
        participants=_participants(),
        sink_factory=_sink_factory([]),
        config=MeetingConfig(),
    )
    assert result is None and orch.calls == []


@pytest.mark.asyncio
async def test_happy_path_drives_orchestrator_and_persists(monkeypatch) -> None:
    async def detect(_wav: bytes, _hint: str) -> tuple[str, str]:
        return ("こんにちは", "ja")

    captured: list = []
    proc, orch, saved, originals = _make(detect, monkeypatch)
    result = await proc.process(
        room_id="r",
        speaker_id="spk",
        pcm16=_PCM,
        speaker_lang_hint="ja",
        participants=_participants(),
        sink_factory=_sink_factory(captured),
        config=MeetingConfig(mode="hybrid"),
    )
    assert result is not None
    call = orch.calls[0]
    assert call["source_language"] == "ja" and call["original_text"] == "こんにちは"
    assert call["mode"] == "hybrid" and call["seq"] == 1 and call["speaker_id"] == "spk"
    assert captured[0]["lis"] == "en"  # 受聴者の目標言語が sink へ渡る
    assert saved[0]["source_language"] == "ja" and saved[0]["text"] == "こんにちは"
    assert originals[0]["original_text"] == "こんにちは"


@pytest.mark.asyncio
async def test_duplicate_text_skips_second(monkeypatch) -> None:
    async def detect(_wav: bytes, _hint: str) -> tuple[str, str]:
        return ("同じ", "ja")

    proc, orch, _saved, _originals = _make(detect, monkeypatch)
    kwargs = {
        "room_id": "r",
        "speaker_id": "spk",
        "pcm16": _PCM,
        "speaker_lang_hint": "ja",
        "participants": _participants(),
        "sink_factory": _sink_factory([]),
        "config": MeetingConfig(),
    }
    assert await proc.process(**kwargs) is not None
    assert await proc.process(**kwargs) is None
    assert len(orch.calls) == 1


@pytest.mark.asyncio
async def test_multi_detection_falls_back_to_hint(monkeypatch) -> None:
    async def detect(_wav: bytes, _hint: str) -> tuple[str, str]:
        return ("hello", "multi")

    proc, orch, _saved, _originals = _make(detect, monkeypatch)
    await proc.process(
        room_id="r",
        speaker_id="spk",
        pcm16=_PCM,
        speaker_lang_hint="en",
        participants=_participants(),
        sink_factory=_sink_factory([]),
        config=MeetingConfig(),
    )
    assert orch.calls[0]["source_language"] == "en"


@pytest.mark.asyncio
async def test_provider_error_text_is_dropped(monkeypatch) -> None:
    async def detect(_wav: bytes, _hint: str) -> tuple[str, str]:
        return ("[ASRエラー: timeout]", "ja")

    proc, orch, saved, originals = _make(detect, monkeypatch)
    result = await proc.process(
        room_id="r",
        speaker_id="spk",
        pcm16=_PCM,
        speaker_lang_hint="ja",
        participants=_participants(),
        sink_factory=_sink_factory([]),
        config=MeetingConfig(),
    )
    assert result is None
    assert orch.calls == []
    assert saved == []
    assert originals == []


def test_forget_room_clears_sequencer_state() -> None:
    """改善点 M5: forget_room で採番・重複排除状態が破棄される。"""
    seq = SubtitleSequencer()
    proc = SegmentProcessor(sequencer=seq)
    seq.next_seq("r")
    seq.remember("r", "spk", "はい")
    proc.forget_room("r")
    # 状態破棄後は重複判定されず、採番も 1 から再開する
    assert seq.is_duplicate("r", "spk", "はい") is False
    assert seq.next_seq("r") == 1


# ============================================================
# P3-D: 回放ログ（PipelineEvent）記録＋音声アーカイブの配線
# ============================================================
def test_degraded_langs_present_pure() -> None:
    """縮退判定（純ロジック）: 訳文欠落の対象言語があれば True。"""
    tags = [{"target_language": "en"}, {"target_language": "zh"}]
    # en は訳文あり、zh は欠落 → 縮退あり
    assert (
        processor_mod._degraded_langs_present(
            source_language="ja", tags=tags, translations={"en": "hi"}
        )
        is True
    )
    # 全対象言語に訳文あり → 縮退なし
    assert (
        processor_mod._degraded_langs_present(
            source_language="ja", tags=tags, translations={"en": "hi", "zh": "你好"}
        )
        is False
    )
    # source と同一言語タグは無視
    assert (
        processor_mod._degraded_langs_present(
            source_language="ja", tags=[{"target_language": "ja"}], translations={}
        )
        is False
    )


class _RecordingOrchWithTags:
    """tags 付きの結果を返すフェイク（縮退判定の検証用）。"""

    def __init__(self, translations: dict, tags: list[dict]) -> None:
        self._translations = translations
        self._tags = tags

    async def orchestrate(self, **kwargs) -> OrchestrationResult:  # noqa: ARG002
        return OrchestrationResult(
            translations=dict(self._translations), tags=list(self._tags)
        )


async def _run_with_event(
    monkeypatch, *, orchestrator, archive=None
) -> tuple[list, list]:
    """record_event_fn＋任意の archive を注入して 1 発話を処理し、記録を捕捉する。"""
    events: list[dict] = []

    async def fake_save(**_kwargs) -> str:
        return "seg-1"

    async def fake_store_original(*_a, **_k) -> None:
        return None

    async def fake_get_session(_room_id: str) -> str:
        return "sess-1"

    async def record_event(**kwargs) -> str:
        events.append(kwargs)
        return "ev-1"

    async def detect(_wav: bytes, _hint: str) -> tuple[str, str]:
        return ("こんにちは", "ja")

    monkeypatch.setattr(processor_mod, "save_transcript_segment", fake_save)
    monkeypatch.setattr(processor_mod.subtitle_cache, "store_original", fake_store_original)
    monkeypatch.setattr(processor_mod, "get_or_create_session", fake_get_session)
    proc = SegmentProcessor(
        orchestrator=orchestrator,
        sequencer=SubtitleSequencer(),
        detect_fn=detect,
        audio_archive=archive,
        record_event_fn=record_event,
    )
    await proc.process(
        room_id="r",
        speaker_id="spk",
        pcm16=_PCM,
        speaker_lang_hint="ja",
        participants=_participants(),
        sink_factory=_sink_factory([]),
        config=MeetingConfig(),
    )
    return events, []


@pytest.mark.asyncio
async def test_pipeline_event_recorded_without_archive(monkeypatch) -> None:
    """record_event_fn 注入・archive 無し → audio_hash=None で事件が記録される。"""
    orch = _RecordingOrchWithTags({"en": "hi"}, [{"target_language": "en"}])
    events, _ = await _run_with_event(monkeypatch, orchestrator=orch)
    assert len(events) == 1
    ev = events[0]
    assert ev["source_language"] == "ja" and ev["asr_text"] == "こんにちは"
    assert ev["transcript_segment_id"] == "seg-1" and ev["session_id"] == "sess-1"
    assert ev["seq"] == 1 and ev["speaker_id"] == "spk"
    assert ev["audio_hash"] is None  # archive 無しでは音声参照なし
    assert ev["translations"] == {"en": "hi"} and ev["degraded"] is False
    assert ev["trace_id"] == "r:spk:1"


class _FakeArchive:
    """store 呼び出しを捕捉し True を返す最小 archive。"""

    def __init__(self) -> None:
        self.stored: list[tuple[str, int]] = []

    async def store(self, audio_hash: str, data: bytes) -> bool:
        self.stored.append((audio_hash, len(data)))
        return True


@pytest.mark.asyncio
async def test_pipeline_event_records_audio_hash_when_archived(monkeypatch) -> None:
    """archive 注入 → 音声を保存し audio_hash が事件へ載る。"""
    orch = _RecordingOrchWithTags({"en": "hi"}, [{"target_language": "en"}])
    archive = _FakeArchive()
    events, _ = await _run_with_event(monkeypatch, orchestrator=orch, archive=archive)
    assert len(archive.stored) == 1
    stored_hash = archive.stored[0][0]
    assert len(stored_hash) == 64  # sha256 hex
    assert events[0]["audio_hash"] == stored_hash


@pytest.mark.asyncio
async def test_pipeline_event_degraded_flag(monkeypatch) -> None:
    """全主線失敗（訳文欠落）の発話は degraded=True で記録される。"""
    # en が翻訳必要だが訳文空 → 縮退
    orch = _RecordingOrchWithTags({}, [{"target_language": "en"}])
    events, _ = await _run_with_event(monkeypatch, orchestrator=orch)
    assert events[0]["degraded"] is True


@pytest.mark.asyncio
async def test_no_event_recorded_when_fn_absent(monkeypatch) -> None:
    """record_event_fn 未注入なら回放ログを記録しない（従来挙動・非破壊）。"""
    called = {"session": False}

    async def fake_save(**_kwargs) -> str:
        return "seg-1"

    async def fake_store_original(*_a, **_k) -> None:
        return None

    async def fake_get_session(_room_id: str) -> str:
        called["session"] = True
        return "sess-1"

    async def detect(_wav: bytes, _hint: str) -> tuple[str, str]:
        return ("こんにちは", "ja")

    monkeypatch.setattr(processor_mod, "save_transcript_segment", fake_save)
    monkeypatch.setattr(processor_mod.subtitle_cache, "store_original", fake_store_original)
    monkeypatch.setattr(processor_mod, "get_or_create_session", fake_get_session)
    proc = SegmentProcessor(
        orchestrator=_RecordingOrchestrator(),
        sequencer=SubtitleSequencer(),
        detect_fn=detect,
    )
    await proc.process(
        room_id="r",
        speaker_id="spk",
        pcm16=_PCM,
        speaker_lang_hint="ja",
        participants=_participants(),
        sink_factory=_sink_factory([]),
        config=MeetingConfig(),
    )
    # get_or_create_session すら呼ばれない（記録経路に入らない）。
    assert called["session"] is False


@pytest.mark.asyncio
async def test_event_recording_failure_does_not_break_process(monkeypatch) -> None:
    """回放ログ経路の例外（get_or_create_session 失敗等）でも収束結果を返す（指摘 3）。"""

    async def fake_save(**_kwargs) -> str:
        return "seg-1"

    async def fake_store_original(*_a, **_k) -> None:
        return None

    async def boom_session(_room_id: str) -> str:
        raise RuntimeError("db down")

    async def record_event(**_kwargs) -> str:
        return "ev-1"

    async def detect(_wav: bytes, _hint: str) -> tuple[str, str]:
        return ("こんにちは", "ja")

    monkeypatch.setattr(processor_mod, "save_transcript_segment", fake_save)
    monkeypatch.setattr(processor_mod.subtitle_cache, "store_original", fake_store_original)
    monkeypatch.setattr(processor_mod, "get_or_create_session", boom_session)
    proc = SegmentProcessor(
        orchestrator=_RecordingOrchestrator(),
        sequencer=SubtitleSequencer(),
        detect_fn=detect,
        record_event_fn=record_event,
    )
    # 例外を投げず、収束結果（orchestrate の戻り）を返すこと。
    result = await proc.process(
        room_id="r",
        speaker_id="spk",
        pcm16=_PCM,
        speaker_lang_hint="ja",
        participants=_participants(),
        sink_factory=_sink_factory([]),
        config=MeetingConfig(),
    )
    assert result is not None


# ============================================================
# P4-A: 話者分離（speaker_label 解決と永続化への配線）
# ============================================================
class _FakeEmbedder:
    """常に固定 embedding を返す SpeakerEmbedder 代替。"""

    def __init__(self, vec: list[float] | None = None, ok: bool = True) -> None:
        self._vec = vec if vec is not None else [1.0, 0.0]
        self._ok = ok

    def available(self) -> bool:
        return self._ok

    async def embed(self, _wav: bytes) -> list[float] | None:
        return self._vec


class _FakeIdentifier:
    """identify 呼び出しを記録し固定ラベルを返す。"""

    def __init__(self, label: str = "Alice") -> None:
        self._label = label
        self.calls: list = []
        self.forgotten: list = []

    def identify(self, room_id, embedding, enrollments):  # noqa: ANN001
        from app.ai_pipeline.diarization import SpeakerIdentity

        self.calls.append((room_id, tuple(embedding), len(enrollments)))
        return SpeakerIdentity(
            user_id="u1", label=self._label, score=0.99, matched=True
        )

    def forget_room(self, room_id: str) -> None:
        self.forgotten.append(room_id)


async def _run_with_diarization(
    monkeypatch, *, embedder, identifier, loader=None
) -> tuple[list, list]:
    """diarization を注入して 1 発話を処理し、save/event の記録を捕捉する。"""
    saved: list[dict] = []
    events: list[dict] = []

    async def fake_save(**kwargs) -> str:
        saved.append(kwargs)
        return "seg-1"

    async def fake_store_original(*_a, **_k) -> None:
        return None

    async def fake_get_session(_room_id: str) -> str:
        return "sess-1"

    async def record_event(**kwargs) -> str:
        events.append(kwargs)
        return "ev-1"

    async def detect(_wav: bytes, _hint: str) -> tuple[str, str]:
        return ("こんにちは", "ja")

    monkeypatch.setattr(processor_mod, "save_transcript_segment", fake_save)
    monkeypatch.setattr(processor_mod.subtitle_cache, "store_original", fake_store_original)
    monkeypatch.setattr(processor_mod, "get_or_create_session", fake_get_session)
    proc = SegmentProcessor(
        orchestrator=_RecordingOrchestrator(),
        sequencer=SubtitleSequencer(),
        detect_fn=detect,
        record_event_fn=record_event,
        speaker_embedder=embedder,
        speaker_identifier=identifier,
        enrollment_loader=loader,
    )
    await proc.process(
        room_id="r",
        speaker_id="spk",
        pcm16=_PCM,
        speaker_lang_hint="ja",
        participants=_participants(),
        sink_factory=_sink_factory([]),
        config=MeetingConfig(),
    )
    return saved, events


@pytest.mark.asyncio
async def test_diarization_label_persisted(monkeypatch) -> None:
    """embedder+identifier 注入 → speaker_label が save と event に載る。"""
    saved, events = await _run_with_diarization(
        monkeypatch, embedder=_FakeEmbedder(), identifier=_FakeIdentifier("Alice")
    )
    assert saved[0]["speaker_label"] == "Alice"
    assert events[0]["speaker_label"] == "Alice"


@pytest.mark.asyncio
async def test_diarization_enrollments_loaded_and_cached(monkeypatch) -> None:
    """enrollment_loader は初回のみ呼ばれ、以降キャッシュされる。"""
    load_calls = {"n": 0}

    async def loader() -> list[tuple[str, str, list[float]]]:
        load_calls["n"] += 1
        return [("u1", "Alice", [1.0, 0.0])]

    ident = _FakeIdentifier("Alice")
    embedder = _FakeEmbedder()

    async def fake_save(**_k) -> str:
        return "seg-1"

    async def fake_store_original(*_a, **_k) -> None:
        return None

    async def fake_get_session(_r: str) -> str:
        return "sess-1"

    async def detect(_w: bytes, _h: str) -> tuple[str, str]:
        return ("こんにちは", "ja")

    monkeypatch.setattr(processor_mod, "save_transcript_segment", fake_save)
    monkeypatch.setattr(processor_mod.subtitle_cache, "store_original", fake_store_original)
    monkeypatch.setattr(processor_mod, "get_or_create_session", fake_get_session)
    proc = SegmentProcessor(
        orchestrator=_RecordingOrchestrator(),
        sequencer=SubtitleSequencer(),
        detect_fn=detect,
        speaker_embedder=embedder,
        speaker_identifier=ident,
        enrollment_loader=loader,
    )
    kwargs = {
        "room_id": "r",
        "speaker_id": "spk",
        "pcm16": _PCM,
        "speaker_lang_hint": "ja",
        "participants": _participants(),
        "sink_factory": _sink_factory([]),
        "config": MeetingConfig(),
    }
    await proc.process(**kwargs)
    # 2 発話目は別テキストにして重複抑制を回避
    monkeypatch.setattr(
        processor_mod,
        "save_transcript_segment",
        lambda **_k: _async_str("seg-2"),
    )

    async def detect2(_w: bytes, _h: str) -> tuple[str, str]:
        return ("さようなら", "ja")

    proc._detect_fn = detect2
    await proc.process(**kwargs)
    # enrollment は 1 回だけロードされる（キャッシュ）
    assert load_calls["n"] == 1
    # identify は 2 発話とも呼ばれ、enrollment 件数 1 を受ける
    assert len(ident.calls) == 2 and ident.calls[0][2] == 1


def _async_str(value: str):
    """テスト補助: 値を返す coroutine を作る。"""

    async def _c(*_a, **_k) -> str:
        return value

    return _c()


@pytest.mark.asyncio
async def test_diarization_disabled_when_embedder_unavailable(monkeypatch) -> None:
    """embedder.available()=False → speaker_label は None（識別せず）。"""
    ident = _FakeIdentifier("X")
    saved, _events = await _run_with_diarization(
        monkeypatch, embedder=_FakeEmbedder(ok=False), identifier=ident
    )
    assert saved[0]["speaker_label"] is None
    assert ident.calls == []  # identify は呼ばれない


@pytest.mark.asyncio
async def test_diarization_none_when_not_injected(monkeypatch) -> None:
    """embedder/identifier 未注入 → speaker_label は None（従来挙動）。"""
    saved, _events = await _run_with_diarization(
        monkeypatch, embedder=None, identifier=None
    )
    assert saved[0]["speaker_label"] is None


def test_forget_room_clears_identifier_state() -> None:
    """forget_room で identifier のクラスタ状態も破棄される。"""
    ident = _FakeIdentifier()
    proc = SegmentProcessor(
        sequencer=SubtitleSequencer(), speaker_identifier=ident
    )
    proc.forget_room("r")
    assert ident.forgotten == ["r"]


@pytest.mark.asyncio
async def test_ab_context_room_and_speaker_set_during_orchestrate(monkeypatch) -> None:
    """orchestrate 実行中に A/B 文脈へ room_id/user_id(speaker) が設定される（②配線）。"""
    from app.ai_pipeline.ab_runtime import get_ab_context
    from app.ai_pipeline.orchestrator import OrchestrationResult

    seen: dict = {}

    class _CtxOrchestrator:
        async def orchestrate(self, **kwargs) -> OrchestrationResult:
            ctx = get_ab_context()
            seen["room_id"] = ctx.room_id if ctx else None
            seen["user_id"] = ctx.user_id if ctx else None
            return OrchestrationResult(translations={kwargs["source_language"]: "x"})

    async def detect(_wav: bytes, _hint: str) -> tuple[str, str]:
        return ("こんにちは", "ja")

    _proc, _orch, _saved, _originals = _make(detect, monkeypatch)
    _proc._orchestrator = _CtxOrchestrator()
    await _proc.process(
        room_id="r1",
        speaker_id="spk",
        pcm16=_PCM,
        speaker_lang_hint="ja",
        participants=_participants(),
        sink_factory=_sink_factory([]),
        config=MeetingConfig(),
    )
    assert seen == {"room_id": "r1", "user_id": "spk"}
    # 発話処理後は文脈がリセットされている（漏洩なし）。
    from app.ai_pipeline.ab_runtime import get_ab_context as _get

    assert _get() is None


@pytest.mark.asyncio
async def test_speaker_label_and_session_flow(monkeypatch) -> None:
    """speaker_label が orchestrate へ渡り、record_event_fn 有効時に session_id が
    A/B 文脈へ載る（speaker_label ライブ表示 + A/B session unit 配線）。"""
    from app.ai_pipeline.ab_runtime import get_ab_context
    from app.ai_pipeline.orchestrator import OrchestrationResult

    seen: dict = {}
    events: list = []

    class _CtxOrchestrator:
        async def orchestrate(self, **kwargs) -> OrchestrationResult:
            ctx = get_ab_context()
            seen["speaker_label"] = kwargs.get("speaker_label")
            seen["session_id"] = ctx.session_id if ctx else None
            return OrchestrationResult(translations={kwargs["source_language"]: "x"})

    async def fake_save(**_kwargs) -> str:
        return "seg-1"

    async def fake_store_original(*_a, **_k) -> None:
        return None

    async def fake_get_session(_room_id: str) -> str:
        return "sess-9"

    async def fake_record(**kwargs) -> str | None:
        events.append(kwargs)
        return "ev-1"

    async def detect(_wav: bytes, _hint: str) -> tuple[str, str]:
        return ("こんにちは", "ja")

    monkeypatch.setattr(processor_mod, "save_transcript_segment", fake_save)
    monkeypatch.setattr(processor_mod.subtitle_cache, "store_original", fake_store_original)
    monkeypatch.setattr(processor_mod, "get_or_create_session", fake_get_session)
    proc = SegmentProcessor(
        orchestrator=_CtxOrchestrator(),
        sequencer=SubtitleSequencer(),
        detect_fn=detect,
        record_event_fn=fake_record,
    )
    # 話者ラベル解決を固定（diarization 実体なしでも検証できるよう差し替え）。
    async def _label(_room_id: str, _wav: bytes) -> str:
        return "Speaker 1"

    proc._resolve_speaker_label = _label  # type: ignore[method-assign]

    await proc.process(
        room_id="r1",
        speaker_id="spk",
        pcm16=_PCM,
        speaker_lang_hint="ja",
        participants=_participants(),
        sink_factory=_sink_factory([]),
        config=MeetingConfig(),
    )
    assert seen == {"speaker_label": "Speaker 1", "session_id": "sess-9"}
    # 回放ログにも speaker_label / session_id が載る。
    assert events and events[0]["speaker_label"] == "Speaker 1"
    assert events[0]["session_id"] == "sess-9"
