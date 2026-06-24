"""参加者 DB write-through（room_manager._persist）のマッピング検証。

対象: RoomManager._persist が ParticipantPreference を upsert_participant の引数へ
正しく写像すること（audio_mode→voice_translation_enabled / target_language→
output_language / native_language→preferred_language）。
方針: DB 非依存。upsert_participant を monkeypatch で捕捉する（test_processor と同流儀）。
"""

import asyncio

import app.webrtc.persistence as persistence_mod
from app.rooms.manager import ParticipantPreference, RoomManager


def _capture(monkeypatch) -> list[dict]:
    """upsert_participant を捕捉するフェイクへ差し替え、記録リストを返す。"""
    saved: list[dict] = []

    async def fake_upsert(**kwargs) -> None:
        saved.append(kwargs)

    monkeypatch.setattr(persistence_mod, "upsert_participant", fake_upsert)
    return saved


def test_translated_mode_maps_to_voice_enabled(monkeypatch) -> None:
    """audio_mode=translated は voice_translation_enabled=True へ写像する"""
    saved = _capture(monkeypatch)
    p = ParticipantPreference(
        user_id="u1",
        display_name="話者",
        native_language="ja",
        audio_mode="translated",
        target_language="en",
    )
    asyncio.run(RoomManager()._persist("r1", p))
    assert saved == [
        {
            "room_id": "r1",
            "user_id": "u1",
            "display_name": "話者",
            "preferred_language": "ja",
            "output_language": "en",
            "voice_translation_enabled": True,
        }
    ]


def test_original_mode_disables_voice(monkeypatch) -> None:
    """audio_mode=original は voice_translation_enabled=False、出力は母語既定"""
    saved = _capture(monkeypatch)
    p = ParticipantPreference(
        user_id="u2",
        display_name="聴者",
        native_language="ja",
        audio_mode="original",
    )
    asyncio.run(RoomManager()._persist("r1", p))
    assert saved[0]["voice_translation_enabled"] is False
    # target_language 未指定なら __post_init__ で native_language が入る
    assert saved[0]["output_language"] == "ja"
