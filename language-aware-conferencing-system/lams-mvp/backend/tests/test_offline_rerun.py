"""OfflineReranker（P3-D 離線高質量重跑）の単体テスト。

DB は使わず、offline_rerun 名前空間へ import された replay/training 関数を
monkeypatch し、ASR/MT/archive は注入フェイクで差し替える。尊重原則の不変条件
（機械重跑の訂正は corrected_by=None かつ split=HOLDOUT）を検証する。
"""

from __future__ import annotations

import types

import pytest

from app.ai_pipeline import offline_rerun
from app.db.models import DataSplit, RerunStatus


class _FakeArchive:
    """audio_hash に対し固定バイト列を返す最小アーカイブ。"""

    def __init__(self, data: bytes | None) -> None:
        self._data = data

    async def load(self, audio_hash: str) -> bytes | None:  # noqa: ARG002
        return self._data


def _make_event(**overrides: object) -> types.SimpleNamespace:
    """属性読み取りのみで足りる PipelineEvent 風フェイクを作る。"""
    base = {
        "id": "ev-1",
        "session_id": "sess-1",
        "transcript_segment_id": "seg-1",
        "source_language": "ja",
        "audio_hash": "hash-1",
        "asr_text": "こんにちわ",
        "translations": {"en": "helo"},
        "degraded": False,
    }
    base.update(overrides)
    return types.SimpleNamespace(**base)


@pytest.fixture
def captured(monkeypatch: pytest.MonkeyPatch) -> dict[str, list]:
    """replay/training 関数を monkeypatch し呼び出しを記録する。"""
    calls: dict[str, list] = {
        "save": [],
        "mark": [],
        "asr_corr": [],
        "mt_corr": [],
    }

    async def fake_save(**kwargs: object) -> str:
        calls["save"].append(kwargs)
        return "rid-1"

    async def fake_mark(event_id: str, status: str) -> bool:
        calls["mark"].append((event_id, status))
        return True

    async def fake_asr_corr(**kwargs: object) -> str:
        calls["asr_corr"].append(kwargs)
        return "asr-corr-1"

    async def fake_mt_corr(**kwargs: object) -> str:
        calls["mt_corr"].append(kwargs)
        return "mt-corr-1"

    monkeypatch.setattr(offline_rerun, "save_rerun_result", fake_save)
    monkeypatch.setattr(offline_rerun, "mark_rerun_status", fake_mark)
    monkeypatch.setattr(offline_rerun, "record_asr_correction", fake_asr_corr)
    monkeypatch.setattr(offline_rerun, "record_translation_correction", fake_mt_corr)
    return calls


def _correcting_asr(text: str = "こんにちは") -> offline_rerun.ASRFn:
    """常に指定テキストを返す ASRFn（実時と異なる＝訂正を誘発）。"""

    async def _fn(wav: bytes, source_language: str) -> str:  # noqa: ARG001
        return text

    return _fn


def _fixed_mt(mapping: dict[str, str]) -> offline_rerun.MTFn:
    """target_language ごとに固定訳を返す MTFn（未登録は ""）。"""

    async def _fn(text: str, source_language: str, target_language: str) -> str:  # noqa: ARG001, E501
        return mapping.get(target_language, "")

    return _fn


@pytest.mark.asyncio
async def test_rerun_event_with_audio_corrects_asr(captured: dict[str, list]) -> None:
    """音声 + ASR 訂正: 高品質原文で保存し ASR 訂正を HOLDOUT で記録する。"""
    reranker = offline_rerun.OfflineReranker(
        asr_fn=_correcting_asr("こんにちは"),
        mt_fn=_fixed_mt({"en": "hello"}),
        archive=_FakeArchive(b"wavbytes"),
        target_languages=("ja", "en"),
    )
    event = _make_event()

    rid = await reranker.rerun_event(event)

    assert rid == "rid-1"
    # 高品質原文で保存
    assert len(captured["save"]) == 1
    assert captured["save"][0]["asr_text"] == "こんにちは"
    # DONE マーク
    assert (event.id, RerunStatus.DONE.value) in captured["mark"]
    # ASR 訂正: 不変条件（機械=著者なし None・HOLDOUT・実時→重跑）
    assert len(captured["asr_corr"]) == 1
    corr = captured["asr_corr"][0]
    # corrected_by は users.id への FK。機械再処理は None（文字列は FK 違反で欠損）。
    assert corr["corrected_by"] is None
    assert corr["split"] == DataSplit.HOLDOUT.value
    assert corr["asr_text"] == event.asr_text and corr["corrected_text"] == "こんにちは"
    assert corr["asr_text"] == "こんにちわ"  # 実時
    assert corr["corrected_text"] == "こんにちは"  # 重跑


@pytest.mark.asyncio
async def test_rerun_event_no_audio_hash_remt_only(captured: dict[str, list]) -> None:
    """音声なし: 再 ASR せず実時原文を用い、訳のみ再処理して MT 訂正を記録する。"""
    reranker = offline_rerun.OfflineReranker(
        asr_fn=_correcting_asr("別物"),  # 呼ばれないはず
        mt_fn=_fixed_mt({"en": "hello"}),
        archive=_FakeArchive(b"wav"),
        target_languages=("ja", "en"),
    )
    event = _make_event(audio_hash=None)

    rid = await reranker.rerun_event(event)

    assert rid == "rid-1"
    # 再 ASR しない → 実時原文のまま
    assert captured["save"][0]["asr_text"] == "こんにちわ"
    # ASR 変化なし → ASR 訂正なし
    assert captured["asr_corr"] == []
    # MT は実時 "helo" と異なる "hello" → HOLDOUT 訂正
    assert len(captured["mt_corr"]) == 1
    mt = captured["mt_corr"][0]
    assert mt["split"] == DataSplit.HOLDOUT.value
    assert mt["target_language"] == "en"
    assert mt["mt_text"] == "helo"
    assert mt["corrected_text"] == "hello"


@pytest.mark.asyncio
async def test_rerun_event_skipped_when_no_text(captured: dict[str, list]) -> None:
    """音声取得不可 + 実時原文空 → SKIPPED、保存せず None を返す。"""
    reranker = offline_rerun.OfflineReranker(
        asr_fn=_correcting_asr("x"),
        mt_fn=_fixed_mt({"en": "hello"}),
        archive=_FakeArchive(None),  # load が None
        target_languages=("ja", "en"),
    )
    event = _make_event(asr_text="")

    rid = await reranker.rerun_event(event)

    assert rid is None
    assert captured["save"] == []
    assert (event.id, RerunStatus.SKIPPED.value) in captured["mark"]


@pytest.mark.asyncio
async def test_save_failure_marks_failed_not_done(
    captured: dict[str, list], monkeypatch: pytest.MonkeyPatch
) -> None:
    """結果保存が None（DB 失敗）→ DONE にせず FAILED（再処理に残す。指摘 2）。"""

    async def failing_save(**_kwargs: object) -> None:
        return None

    monkeypatch.setattr(offline_rerun, "save_rerun_result", failing_save)
    reranker = offline_rerun.OfflineReranker(
        asr_fn=_correcting_asr("こんにちは"),
        mt_fn=_fixed_mt({"en": "hello"}),
        archive=_FakeArchive(b"wav"),
        target_languages=("ja", "en"),
    )
    event = _make_event()

    rid = await reranker.rerun_event(event)

    assert rid is None
    # FAILED としてマーク、DONE にはしない（再処理対象に残る）。
    assert (event.id, RerunStatus.FAILED.value) in captured["mark"]
    assert (event.id, RerunStatus.DONE.value) not in captured["mark"]
    # 保存失敗時は訂正も出さない。
    assert captured["asr_corr"] == [] and captured["mt_corr"] == []


@pytest.mark.asyncio
async def test_emit_corrections_false(captured: dict[str, list]) -> None:
    """emit_corrections=False: 差分があっても訂正を一切記録しない。"""
    reranker = offline_rerun.OfflineReranker(
        asr_fn=_correcting_asr("こんにちは"),
        mt_fn=_fixed_mt({"en": "hello"}),
        archive=_FakeArchive(b"wav"),
        target_languages=("ja", "en"),
        emit_corrections=False,
    )
    event = _make_event()

    rid = await reranker.rerun_event(event)

    assert rid == "rid-1"
    assert captured["asr_corr"] == []
    assert captured["mt_corr"] == []


@pytest.mark.asyncio
async def test_asr_fn_raises_marks_failed(captured: dict[str, list]) -> None:
    """ASR 呼び出しが例外 → 事件は FAILED、クラッシュせず None を返す。"""

    async def _boom(wav: bytes, source_language: str) -> str:  # noqa: ARG001
        raise RuntimeError("asr crashed")

    reranker = offline_rerun.OfflineReranker(
        asr_fn=_boom,
        mt_fn=_fixed_mt({"en": "hello"}),
        archive=_FakeArchive(b"wav"),
        target_languages=("ja", "en"),
    )
    event = _make_event()

    rid = await reranker.rerun_event(event)

    assert rid is None
    assert (event.id, RerunStatus.FAILED.value) in captured["mark"]
    assert captured["save"] == []


@pytest.mark.asyncio
async def test_correction_write_failure_does_not_fail_rerun(
    captured: dict[str, list], monkeypatch: pytest.MonkeyPatch
) -> None:
    """訂正書き込みが例外でも重跑は成功: DONE マークし rid を返す。"""

    async def _boom(**kwargs: object) -> str:  # noqa: ARG001
        raise RuntimeError("training write failed")

    monkeypatch.setattr(offline_rerun, "record_asr_correction", _boom)

    reranker = offline_rerun.OfflineReranker(
        asr_fn=_correcting_asr("こんにちは"),
        mt_fn=_fixed_mt({"en": "hello"}),
        archive=_FakeArchive(b"wav"),
        target_languages=("ja", "en"),
    )
    event = _make_event()

    rid = await reranker.rerun_event(event)

    assert rid == "rid-1"
    assert (event.id, RerunStatus.DONE.value) in captured["mark"]


@pytest.mark.asyncio
async def test_rerun_session_tallies_summary(
    captured: dict[str, list],  # noqa: ARG001 - monkeypatch 副作用のため必要
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """rerun_session: re-ASR 変化 / SKIP / 通常 の混在で集計が整合する。"""
    events = [
        _make_event(id="ev-a"),  # 再 ASR 変化 → done
        _make_event(id="ev-b", audio_hash=None, asr_text=""),  # skip
        _make_event(id="ev-c", audio_hash=None),  # 音声なし・原文あり → done
    ]

    async def fake_list(session_id: str) -> list:  # noqa: ARG001
        return events

    monkeypatch.setattr(offline_rerun, "list_rerunnable_events", fake_list)

    reranker = offline_rerun.OfflineReranker(
        asr_fn=_correcting_asr("こんにちは"),
        mt_fn=_fixed_mt({"en": "hello"}),
        archive=_FakeArchive(b"wav"),
        target_languages=("ja", "en"),
    )

    summary = await reranker.rerun_session("sess-1")

    assert summary.total == 3
    assert summary.skipped == 1
    assert summary.done == 2
    assert summary.failed == 0
    assert summary.done + summary.skipped + summary.failed == summary.total


@pytest.mark.asyncio
async def test_translations_none_when_no_mt_fn(captured: dict[str, list]) -> None:
    """mt_fn 未注入: translations2 は空 → 保存は translations=None、MT 訂正なし。"""
    reranker = offline_rerun.OfflineReranker(
        asr_fn=_correcting_asr("こんにちは"),
        mt_fn=None,
        archive=_FakeArchive(b"wav"),
        target_languages=("ja", "en"),
    )
    event = _make_event()

    rid = await reranker.rerun_event(event)

    assert rid == "rid-1"
    assert captured["save"][0]["translations"] is None
    assert captured["mt_corr"] == []
