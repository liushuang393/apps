"""本番向けセキュリティ設定の回帰テスト。"""

import pytest

from app.config import settings
from app.main import DEFAULT_JWT_SECRET, _validate_security_settings


def test_production_rejects_default_jwt_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    """本番環境では既定 JWT シークレットを拒否する。"""
    monkeypatch.setattr(settings, "env", "production")
    monkeypatch.setattr(settings, "jwt_secret", DEFAULT_JWT_SECRET)

    with pytest.raises(RuntimeError, match="JWT_SECRET"):
        _validate_security_settings()


def test_production_accepts_strong_jwt_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    """本番環境では十分な長さの独自シークレットを許可する。"""
    monkeypatch.setattr(settings, "env", "production")
    monkeypatch.setattr(settings, "jwt_secret", "a" * 32)
    monkeypatch.setattr(settings, "livekit_api_secret", "b" * 32)

    _validate_security_settings()


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        # compose の既定値は 32 文字以上でも既知の値なので拒否する。
        ("jwt_secret", "sonowa-jwt-secret-change-in-production", "JWT_SECRET"),
        ("livekit_api_secret", "devsecret_change_in_production", "LIVEKIT_API_SECRET"),
        ("livekit_api_secret", None, "LIVEKIT_API_SECRET"),
        ("livekit_api_secret", "short", "LIVEKIT_API_SECRET"),
    ],
)
def test_production_rejects_known_or_weak_secrets(
    monkeypatch: pytest.MonkeyPatch, field: str, value: str | None, message: str
) -> None:
    """本番では既知の開発用シークレットや短いシークレットで起動しない。"""
    monkeypatch.setattr(settings, "env", "production")
    monkeypatch.setattr(settings, "jwt_secret", "a" * 32)
    monkeypatch.setattr(settings, "livekit_api_secret", "b" * 32)
    monkeypatch.setattr(settings, field, value)

    with pytest.raises(RuntimeError, match=message):
        _validate_security_settings()
