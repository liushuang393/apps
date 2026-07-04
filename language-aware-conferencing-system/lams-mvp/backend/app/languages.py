"""
LAMS 言語設定の単一ソース。

目的:
    - backend で使う対応可能言語・既定有効言語・表示名を 1 か所に集約する。
    - 管理者設定（SystemConfig.enabled_languages）が無ければ既定値へフォールバックする。
"""

from __future__ import annotations

import json

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import SystemConfig

ALL_SUPPORTED_LANGUAGES = [
    "en",
    "ja",
    "zh",
    "ko",
    "vi",
    "fr",
    "de",
    "ru",
    "es",
    "pt",
]

DEFAULT_ENABLED_LANGUAGES = ["ja", "en", "zh", "vi"]
MAX_ENABLED_LANGUAGES = 4

LANGUAGE_DISPLAY_NAMES = {
    "en": "English",
    "ja": "日本語",
    "zh": "中文",
    "ko": "한국어",
    "vi": "Tiếng Việt",
    "fr": "Français",
    "de": "Deutsch",
    "ru": "Русский",
    "es": "Español",
    "pt": "Português",
}

LANGUAGE_TIERS = {
    "en": 1,
    "ja": 2,
    "zh": 2,
    "ko": 2,
    "vi": 3,
    "fr": 1,
    "de": 1,
    "ru": 2,
    "es": 1,
    "pt": 1,
}


async def get_enabled_languages(db: AsyncSession) -> list[str]:
    """有効言語一覧を取得する。未設定時は既定値を返す。"""
    result = await db.execute(
        select(SystemConfig).where(SystemConfig.key == "enabled_languages")
    )
    row = result.scalar_one_or_none()
    if row is None:
        return list(DEFAULT_ENABLED_LANGUAGES)
    try:
        enabled = json.loads(row.value)
    except json.JSONDecodeError:
        return list(DEFAULT_ENABLED_LANGUAGES)
    if not isinstance(enabled, list):
        return list(DEFAULT_ENABLED_LANGUAGES)
    filtered: list[str] = []
    for lang in enabled:
        if lang not in ALL_SUPPORTED_LANGUAGES or lang in filtered:
            continue
        filtered.append(lang)
        if len(filtered) >= MAX_ENABLED_LANGUAGES:
            break
    return filtered or list(DEFAULT_ENABLED_LANGUAGES)
