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

    _validate_security_settings()
