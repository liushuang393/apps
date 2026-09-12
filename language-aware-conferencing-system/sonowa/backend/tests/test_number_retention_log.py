"""数字保持の後処理検証ログ（改善点 Q5）の回帰テスト。

_call_openai_translate は訳文で数字が欠落した場合に WARNING を残す（訳文は改変
しない純観測）。OpenAI クライアントと用語集ヒントをモックして I/O 非依存に検証する。
"""

import logging

import pytest

from app.config import settings
from app.translate import glossary, routes


class _Msg:
    def __init__(self, content: str) -> None:
        self.content = content


class _Choice:
    def __init__(self, content: str) -> None:
        self.message = _Msg(content)


class _Resp:
    def __init__(self, content: str) -> None:
        self.choices = [_Choice(content)]


class _Completions:
    def __init__(self, content: str) -> None:
        self._content = content

    async def create(self, **_kwargs: object) -> _Resp:
        return _Resp(self._content)


class _Chat:
    def __init__(self, content: str) -> None:
        self.completions = _Completions(content)


class _FakeClient:
    def __init__(self, content: str) -> None:
        self.chat = _Chat(content)


def _patch(monkeypatch, translated: str) -> None:
    """OpenAI クライアント・用語集・APIキーをモックする。"""
    import openai

    monkeypatch.setattr(settings, "openai_api_key", "test-key")
    monkeypatch.setattr(openai, "AsyncOpenAI", lambda **_k: _FakeClient(translated))

    async def _no_hint(*_a: object, **_k: object) -> str:
        return ""

    monkeypatch.setattr(glossary, "build_hint_for_text", _no_hint)


@pytest.mark.asyncio
async def test_number_drop_emits_warning(monkeypatch, caplog):
    """原文に数字があり訳文で欠落したら WARNING を出す。"""
    _patch(monkeypatch, translated="There are some items")  # 42 が欠落
    with caplog.at_level(logging.WARNING, logger=routes.logger.name):
        out = await routes._call_openai_translate("42個あります", "ja", "en")
    assert out == "There are some items"  # 訳文は改変されない
    assert any("数字保持率" in r.message for r in caplog.records)


@pytest.mark.asyncio
async def test_number_preserved_no_warning(monkeypatch, caplog):
    """数字が保持されていれば WARNING を出さない。"""
    _patch(monkeypatch, translated="There are 42 items")
    with caplog.at_level(logging.WARNING, logger=routes.logger.name):
        await routes._call_openai_translate("42個あります", "ja", "en")
    assert not any("数字保持率" in r.message for r in caplog.records)


@pytest.mark.asyncio
async def test_no_number_no_warning(monkeypatch, caplog):
    """原文に数字が無ければ検証対象外（WARNING なし）。"""
    _patch(monkeypatch, translated="Hello")
    with caplog.at_level(logging.WARNING, logger=routes.logger.name):
        await routes._call_openai_translate("こんにちは", "ja", "en")
    assert not any("数字保持率" in r.message for r in caplog.records)
