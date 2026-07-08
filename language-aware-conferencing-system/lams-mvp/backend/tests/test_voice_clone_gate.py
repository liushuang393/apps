"""音色クローンゲート（P4-B）の単体テスト：同意ゲート・透かし必須の強制。

同意判定・クローン合成・透かしはすべて注入/monkeypatch し、DB や実 TTS 無しで
「無同意は合成関数を呼ばない」「同意時は透かし必須」の不変条件を検証する。
"""

import pytest

from app.ai_pipeline import voice_clone_gate
from app.ai_pipeline.voice_clone_gate import VoiceCloneGate
from app.ai_pipeline.voice_consent import ConsentDecision


def _checker(decision: ConsentDecision):
    async def _c(user_id: str, voice_id: str, scope: str) -> ConsentDecision:  # noqa: ARG001
        return decision

    return _c


def _synth(audio: bytes | None, sink: list | None = None):
    async def _s(text: str, language: str, voice_id: str) -> bytes | None:
        if sink is not None:
            sink.append((text, language, voice_id))
        return audio

    return _s


@pytest.mark.asyncio
async def test_no_consent_does_not_call_synth() -> None:
    """無同意 → クローン合成関数を呼ばず audio=None。"""
    calls: list = []
    gate = VoiceCloneGate(
        _synth(b"RIFFxxxx", calls),
        consent_checker=_checker(ConsentDecision(False, True, "no_consent")),
    )
    r = await gate.synthesize(
        user_id="u1", voice_id="v1", text="hi", language="ja"
    )
    assert r.audio is None and r.allowed is False
    assert calls == []  # 合成関数は呼ばれない（最重要不変条件）


@pytest.mark.asyncio
async def test_consent_applies_watermark(monkeypatch) -> None:
    """同意 + 透かし必須 → 合成し透かしを適用して返す。"""
    monkeypatch.setattr(
        voice_clone_gate, "apply_watermark", lambda wav: wav + b"::WM"
    )
    monkeypatch.setattr(
        voice_clone_gate, "is_watermarked", lambda wav: wav.endswith(b"::WM")
    )
    gate = VoiceCloneGate(
        _synth(b"AUDIO"),
        consent_checker=_checker(ConsentDecision(True, True, "granted")),
    )
    r = await gate.synthesize(user_id="u1", voice_id="v1", text="hi", language="ja")
    assert r.allowed is True and r.watermarked is True
    assert r.audio == b"AUDIO::WM"


@pytest.mark.asyncio
async def test_consent_no_watermark_required(monkeypatch) -> None:
    """同意で透かし任意 → 透かしを付けずそのまま返す。"""
    called = {"wm": False}

    def _wm(wav):
        called["wm"] = True
        return wav

    monkeypatch.setattr(voice_clone_gate, "apply_watermark", _wm)
    gate = VoiceCloneGate(
        _synth(b"AUDIO"),
        consent_checker=_checker(ConsentDecision(True, False, "granted_no_wm")),
    )
    r = await gate.synthesize(user_id="u1", voice_id="v1", text="hi", language="ja")
    assert r.audio == b"AUDIO" and r.watermarked is False
    assert called["wm"] is False  # 透かし関数は呼ばれない


@pytest.mark.asyncio
async def test_synth_failure_returns_none() -> None:
    """合成が None（失敗）→ audio=None（allowed は True のまま）。"""
    gate = VoiceCloneGate(
        _synth(None),
        consent_checker=_checker(ConsentDecision(True, True, "granted")),
    )
    r = await gate.synthesize(user_id="u1", voice_id="v1", text="hi", language="ja")
    assert r.audio is None and r.allowed is True and r.reason == "synth_failed"


@pytest.mark.asyncio
async def test_watermark_failure_discards_audio(monkeypatch) -> None:
    """透かし必須なのに透かしが付かない → 無透かしのクローン音を配信しない（安全側）。"""
    monkeypatch.setattr(voice_clone_gate, "apply_watermark", lambda wav: wav)
    monkeypatch.setattr(voice_clone_gate, "is_watermarked", lambda _wav: False)
    gate = VoiceCloneGate(
        _synth(b"AUDIO"),
        consent_checker=_checker(ConsentDecision(True, True, "granted")),
    )
    r = await gate.synthesize(user_id="u1", voice_id="v1", text="hi", language="ja")
    assert r.audio is None and r.reason == "watermark_failed"
