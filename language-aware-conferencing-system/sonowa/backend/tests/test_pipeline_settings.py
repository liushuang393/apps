"""
AI パイプライン実行時設定（effective_config / admin API）の単体テスト。
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

from app.admin import routes as admin_routes
from app.ai_pipeline import effective_config as ec
from app.ai_pipeline.providers import (
    get_ai_provider,
    invalidate_ai_provider_cache,
)
from app.db.models import MeetingMode, User
from app.rooms import routes as room_routes


@pytest.fixture(autouse=True)
def _reset_pipeline_cache() -> None:
    """各テスト前後でキャッシュを初期化する。"""
    ec.reset_pipeline_settings_cache_for_tests()
    invalidate_ai_provider_cache()
    yield
    ec.reset_pipeline_settings_cache_for_tests()
    invalidate_ai_provider_cache()


def test_env_only_effective_matches_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """DB 未設定なら effective は env 既定と一致する。"""
    monkeypatch.setattr(ec.settings, "ai_provider", "gpt4o_transcribe")
    monkeypatch.setattr(ec.settings, "asr_provider", "auto")
    monkeypatch.setattr(ec.settings, "mt_provider", "auto")
    monkeypatch.setattr(ec.settings, "tts_provider", "auto")
    values = ec.merge_overlay(None)
    assert values.ai_provider == "gpt4o_transcribe"
    assert values.asr_provider == "auto"
    assert values.default_mode == "a"


def test_db_overlay_overrides_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """SystemConfig 上書きが env より優先される。"""
    monkeypatch.setattr(ec.settings, "ai_provider", "gpt4o_transcribe")
    values = ec.merge_overlay(
        {
            "ai_provider": "gpt_realtime",
            "default_mode": "b",
            "asr_provider": "local",
        }
    )
    assert values.ai_provider == "gpt_realtime"
    assert values.default_mode == "b"
    assert values.asr_provider == "local"
    assert values.mt_provider == "auto"


def test_invalid_overlay_key_falls_back(monkeypatch: pytest.MonkeyPatch) -> None:
    """不正 enum はキー単位で無視して env へ縮退する。"""
    monkeypatch.setattr(ec.settings, "ai_provider", "deepgram")
    values = ec.merge_overlay({"ai_provider": "not_a_provider"})
    assert values.ai_provider == "deepgram"


def test_validate_pipeline_payload_rejects_unknown() -> None:
    """未知フィールドは ValueError。"""
    with pytest.raises(ValueError, match="未知のフィールド"):
        ec.validate_pipeline_payload({"openai_api_key": "sk-secret"})


def test_validate_pipeline_payload_rejects_bad_enum() -> None:
    """不正 enum は ValueError。"""
    with pytest.raises(ValueError, match="ai_provider"):
        ec.validate_pipeline_payload({"ai_provider": "nope"})


def test_validate_and_merge_quality_pack_bools(monkeypatch: pytest.MonkeyPatch) -> None:
    """方式2品質パックの真偽フラグを overlay / validate できる。"""
    monkeypatch.setattr(ec.settings, "enable_partial_subtitles", False)
    monkeypatch.setattr(ec.settings, "llm_correction_provider", "off")
    values = ec.validate_pipeline_payload(
        {
            "ai_provider": "gpt4o_transcribe",
            "default_mode": "hybrid",
            "enable_partial_subtitles": True,
            "llm_correction_enabled": True,
        }
    )
    assert values.enable_partial_subtitles is True
    assert values.llm_correction_enabled is True
    assert values.default_mode == "hybrid"

    merged = ec.merge_overlay(
        {
            "enable_partial_subtitles": True,
            "llm_correction_enabled": False,
        }
    )
    assert merged.enable_partial_subtitles is True
    assert merged.llm_correction_enabled is False


def test_validate_pipeline_payload_rejects_bad_bool() -> None:
    """真偽フィールドに非 bool は ValueError。"""
    with pytest.raises(ValueError, match="enable_partial_subtitles"):
        ec.validate_pipeline_payload({"enable_partial_subtitles": "yes"})


def test_local_mt_warns_glossary_unsupported(monkeypatch: pytest.MonkeyPatch) -> None:
    """local MT は用語集非対応の警告を出す。"""
    monkeypatch.setattr(ec.settings, "openai_api_key", "sk-test")
    warnings = ec.collect_availability_warnings(
        ec.PipelineSettingsValues(
            ai_provider="gpt4o_transcribe",
            asr_provider="auto",
            mt_provider="local",
            tts_provider="auto",
            default_mode="b",
        )
    )
    assert any("用語集" in w for w in warnings)


def test_fully_local_hybrid_does_not_require_cloud_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """全段階 local の方式2では未使用クラウド資格の警告を出さない。"""
    monkeypatch.setattr(ec.settings, "openai_api_key", "")
    values = ec.PipelineSettingsValues(
        ai_provider="gpt4o_transcribe",
        asr_provider="local",
        mt_provider="local",
        tts_provider="local",
        default_mode="hybrid",
        llm_correction_enabled=False,
    )
    assert not any(
        "OPENAI_API_KEY" in w for w in ec.collect_availability_warnings(values)
    )


def test_set_cached_bumps_revision() -> None:
    """キャッシュ更新で revision が増える。"""
    before = ec.get_revision()
    rev = ec.set_cached_pipeline_settings(
        ec.PipelineSettingsValues(
            ai_provider="gpt_realtime",
            asr_provider="auto",
            mt_provider="auto",
            tts_provider="auto",
            default_mode="a",
        )
    )
    assert rev == before + 1
    assert ec.get_cached_pipeline_settings().ai_provider == "gpt_realtime"


def test_get_ai_provider_follows_effective_cache(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """effective 切替後、get_ai_provider が新インスタンス種別になる。"""
    from app.ai_pipeline.providers.gpt4o_transcribe import GPT4oTranscribeProvider
    from app.ai_pipeline.providers.gpt_realtime import GPTRealtimeProvider

    monkeypatch.setattr(
        "app.ai_pipeline.providers.gpt4o_transcribe.check_api_key",
        lambda *_a, **_k: None,
    )
    monkeypatch.setattr(
        "app.ai_pipeline.providers.gpt_realtime.check_api_key",
        lambda *_a, **_k: None,
    )
    # settings.openai_api_key が空でも生成できるようにする
    monkeypatch.setattr(
        "app.ai_pipeline.providers.gpt4o_transcribe.settings.openai_api_key",
        "sk-test",
        raising=False,
    )
    monkeypatch.setattr(
        "app.ai_pipeline.providers.gpt_realtime.settings.openai_api_key",
        "sk-test",
        raising=False,
    )

    ec.set_cached_pipeline_settings(
        ec.PipelineSettingsValues(
            ai_provider="gpt4o_transcribe",
            asr_provider="auto",
            mt_provider="auto",
            tts_provider="auto",
            default_mode="a",
        )
    )
    invalidate_ai_provider_cache()
    first = get_ai_provider()
    assert isinstance(first, GPT4oTranscribeProvider)

    ec.set_cached_pipeline_settings(
        ec.PipelineSettingsValues(
            ai_provider="gpt_realtime",
            asr_provider="auto",
            mt_provider="auto",
            tts_provider="auto",
            default_mode="a",
        )
    )
    invalidate_ai_provider_cache()
    second = get_ai_provider()
    assert isinstance(second, GPTRealtimeProvider)


@pytest.mark.asyncio
async def test_admin_put_invalid_enum_returns_400() -> None:
    """不正 enum の PUT は 400。"""
    admin = User(id="a1", display_name="Admin", role="admin", email="a@x.com")
    db = AsyncMock()
    with pytest.raises(HTTPException) as exc:
        await admin_routes.update_ai_pipeline_settings(
            admin_routes.PipelineSettingsUpdateRequest(ai_provider="nope"),
            admin=admin,
            db=db,
        )
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_admin_put_saves_and_bumps_revision(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """PUT 成功で DB 保存相当と revision bump。"""
    admin = User(id="a1", display_name="Admin", role="admin", email="a@x.com")

    class _FakeResult:
        def scalar_one_or_none(self) -> None:
            return None

    db = AsyncMock()
    db.execute = AsyncMock(return_value=_FakeResult())
    db.add = MagicMock()
    db.commit = AsyncMock()

    close_all = AsyncMock()
    monkeypatch.setattr(
        "app.ai_pipeline.runtime.factory.runtime_registry.close_all",
        close_all,
    )

    before = ec.get_revision()
    resp = await admin_routes.update_ai_pipeline_settings(
        admin_routes.PipelineSettingsUpdateRequest(
            ai_provider="gpt_realtime",
            default_mode="b",
            enable_partial_subtitles=True,
            llm_correction_enabled=True,
        ),
        admin=admin,
        db=db,
    )
    assert resp.effective.ai_provider == "gpt_realtime"
    assert resp.effective.default_mode == "b"
    assert resp.effective.enable_partial_subtitles is True
    assert resp.effective.llm_correction_enabled is True
    assert resp.revision == before + 1
    db.add.assert_called()
    db.commit.assert_awaited()
    close_all.assert_awaited()


@pytest.mark.asyncio
async def test_room_create_uses_system_default_mode(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """RoomCreate で default_mode 省略時は system 既定を採用する。"""
    ec.set_cached_pipeline_settings(
        ec.PipelineSettingsValues(
            ai_provider="gpt4o_transcribe",
            asr_provider="auto",
            mt_provider="auto",
            tts_provider="auto",
            default_mode="b",
        )
    )

    captured: dict[str, object] = {}

    class _FakeDb:
        def add(self, room: object) -> None:
            captured["room"] = room

        async def commit(self) -> None:
            return None

        async def refresh(self, room: object) -> None:
            if not getattr(room, "id", None):
                room.id = "room-1"  # type: ignore[attr-defined]
            room.is_active = True  # type: ignore[attr-defined]

        async def delete(self, _room: object) -> None:
            return None

    async def _fake_enabled(_db: object) -> list[str]:
        return ["ja", "en", "zh", "vi"]

    async def _fake_count(_room_id: str) -> int:
        return 0

    monkeypatch.setattr(room_routes, "get_enabled_languages", _fake_enabled)
    monkeypatch.setattr(
        room_routes.room_manager,
        "create_room_state",
        AsyncMock(),
    )
    monkeypatch.setattr(room_routes, "_safe_participant_count", _fake_count)

    user = User(id="u1", display_name="U", role="user", email="u@x.com")
    data = room_routes.RoomCreate(name="test-room")
    assert data.default_mode is None

    resp = await room_routes.create_room(data, user=user, db=_FakeDb())  # type: ignore[arg-type]
    room = captured["room"]
    assert room.default_mode == "b"
    assert resp.default_mode == "b"
    assert MeetingMode.B.value == "b"


def test_require_admin_dependency_is_wired_on_put() -> None:
    """PUT エンドポイントが require_admin に依存していること（依存宣言の静的確認）。"""
    import inspect

    sig = inspect.signature(admin_routes.update_ai_pipeline_settings)
    admin_param = sig.parameters["admin"]
    assert admin_param.default is not inspect.Parameter.empty
    # Depends(require_admin) であること
    assert "require_admin" in repr(admin_param.default)
