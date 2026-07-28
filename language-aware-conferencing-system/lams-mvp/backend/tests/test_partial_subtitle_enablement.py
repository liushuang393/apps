"""暫定字幕（partial）の有効化導線が機能することを検証する。

背景:
    ``ENABLE_PARTIAL_SUBTITLES`` は既定 False（final のみ）である。これは
    暫定字幕が発話中に追加の ASR 呼び出しを発生させるため、本地／低遅延 ASR 環境
    向けの任意機能という設計判断による（config.py / .env.example に明記）。
    ただし「既定 OFF」と「有効化しても動かない」は区別が必要であり、受入では
    後者かどうかを判定できなかった。

検証内容:
    設定を有効化したとき、既定 segmenter が暫定イベントを実際に切り出すこと
    （＝有効化導線が生きていること）と、無効時は final のみであることを確認する。
"""

from __future__ import annotations

import pytest

from app.config import settings
from app.webrtc.ingress_pipeline import build_default_segmenter

SAMPLE_RATE = 16000
FRAME_MS = 20
_LOUD_FRAME = b"\x00\x40" * (SAMPLE_RATE * FRAME_MS // 1000)


def _feed_speech(segmenter, frames: int) -> list:
    """発話中フレームを連続投入し、発生したイベントを返す。"""
    events = []
    for _ in range(frames):
        events.extend(segmenter.push_events(_LOUD_FRAME))
    return events


@pytest.fixture(autouse=True)
def force_energy_vad(monkeypatch: pytest.MonkeyPatch) -> None:
    """VAD backend をエネルギー方式に固定する（Silero 有無に依存しない）。"""
    monkeypatch.setattr("app.audio.vad.resolve_backend", lambda _backend=None: "energy")


def test_partial_events_emitted_when_enabled(monkeypatch: pytest.MonkeyPatch) -> None:
    """有効化すると発話中に暫定イベントが切り出される。"""
    monkeypatch.setattr(settings, "enable_partial_subtitles", True)
    monkeypatch.setattr(settings, "partial_ms", 200)

    segmenter = build_default_segmenter(sample_rate=SAMPLE_RATE)
    events = _feed_speech(segmenter, frames=60)

    assert any(event.is_partial for event in events), (
        "ENABLE_PARTIAL_SUBTITLES を有効にしても暫定字幕が切り出されない"
    )


def test_partial_events_absent_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    """既定（無効）では暫定イベントを出さない（final のみ）。"""
    monkeypatch.setattr(settings, "enable_partial_subtitles", False)

    segmenter = build_default_segmenter(sample_rate=SAMPLE_RATE)
    events = _feed_speech(segmenter, frames=60)

    assert not any(event.is_partial for event in events)
