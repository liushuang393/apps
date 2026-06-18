"""
build_listeners（app.webrtc.listeners）の単体テスト。

ParticipantPreference 群 → Listener 群／user_id→目標言語表への写像を検証する。
翻訳音声の受信可否（translated モードかつ非話者）と目標言語の解決規則を中心に確認。
"""

from app.rooms.manager import ParticipantPreference
from app.webrtc.listeners import build_listeners, resolve_target_language


def _p(
    user_id: str,
    native: str,
    *,
    audio_mode: str = "original",
    subtitle: bool = True,
    target: str = "",
) -> ParticipantPreference:
    return ParticipantPreference(
        user_id=user_id,
        display_name=user_id,
        native_language=native,
        audio_mode=audio_mode,  # type: ignore[arg-type]
        subtitle_enabled=subtitle,
        target_language=target,
    )


def test_resolve_target_prefers_explicit_target() -> None:
    """target_language があればそれを、無ければ native を使う。"""
    assert resolve_target_language(_p("u", "ja", target="en")) == "en"
    assert resolve_target_language(_p("u", "ja")) == "ja"


def test_translated_listener_wants_audio() -> None:
    """translated モードの非話者は翻訳音声を受信する。"""
    parts = {"u1": _p("u1", "ja", audio_mode="translated", target="en")}
    listeners, user_language = build_listeners(parts, speaker_id="spk")
    assert len(listeners) == 1
    ls = listeners[0]
    assert ls.user_id == "u1" and ls.target_language == "en"
    assert ls.wants_audio is True and ls.subtitle_enabled is True
    assert user_language == {"u1": "en"}


def test_original_mode_listener_no_audio() -> None:
    """原声モードは翻訳音声を受信しない（LiveKit 原音トラックを直接購読）。"""
    parts = {"u1": _p("u1", "ja", audio_mode="original")}
    listeners, _ = build_listeners(parts, speaker_id="spk")
    assert listeners[0].wants_audio is False


def test_speaker_self_no_audio_but_keeps_subtitle() -> None:
    """話者自身は translated でも音声を受信しない（エコー防止）が字幕は保持。"""
    parts = {"spk": _p("spk", "ja", audio_mode="translated", target="en")}
    listeners, _ = build_listeners(parts, speaker_id="spk")
    assert listeners[0].wants_audio is False
    assert listeners[0].subtitle_enabled is True


def test_multiple_participants_mapping() -> None:
    """複数参加者の目標言語表が user_id ごとに正しく構築される。"""
    parts = {
        "u1": _p("u1", "ja", audio_mode="translated", target="en"),
        "u2": _p("u2", "en", audio_mode="original"),
        "u3": _p("u3", "zh", audio_mode="translated"),
    }
    listeners, user_language = build_listeners(parts, speaker_id="u2")
    assert len(listeners) == 3
    assert user_language == {"u1": "en", "u2": "en", "u3": "zh"}
