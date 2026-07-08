"""翻訳記憶（TM）の単体テスト：正規化完全一致・fuzzy・世代分離・障害縮退。"""

import pytest

from app.translate import translation_memory as tm


class FakeRedis:
    """TM が使う get/setex/lpush/ltrim/lrange の最小 in-memory 実装。"""

    def __init__(self) -> None:
        self.kv: dict[str, str] = {}
        self.lists: dict[str, list[str]] = {}

    async def get(self, key: str) -> str | None:
        return self.kv.get(key)

    async def setex(self, key: str, _ttl: int, value: str) -> None:
        self.kv[key] = value

    async def lpush(self, key: str, value: str) -> None:
        self.lists.setdefault(key, []).insert(0, value)

    async def lrem(self, key: str, _count: int, value: str) -> None:
        self.lists[key] = [v for v in self.lists.get(key, []) if v != value]

    async def ltrim(self, key: str, start: int, end: int) -> None:
        self.lists[key] = self.lists.get(key, [])[start : end + 1]

    async def lrange(self, key: str, start: int, end: int) -> list[str]:
        return self.lists.get(key, [])[start : end + 1]

    async def expire(self, _key: str, _ttl: int) -> None:
        pass


@pytest.fixture
def fake_redis(monkeypatch) -> FakeRedis:
    r = FakeRedis()

    async def _get_redis() -> FakeRedis:
        return r

    monkeypatch.setattr(tm, "_get_redis", _get_redis)
    return r


@pytest.mark.asyncio
async def test_store_then_exact_lookup(fake_redis) -> None:  # noqa: ARG001
    await tm.store("Hello world", "en", "ja", "こんにちは世界")
    hit = await tm.lookup("Hello world", "en", "ja")
    assert hit == "こんにちは世界"


@pytest.mark.asyncio
async def test_normalized_match_ignores_case_and_trailing_punct(fake_redis) -> None:  # noqa: ARG001
    await tm.store("Hello world", "en", "ja", "こんにちは世界")
    # 大小文字・末尾句読点・余分な空白の差は正規化完全一致で拾う。
    assert await tm.lookup("  hello   WORLD!! ", "en", "ja") == "こんにちは世界"


@pytest.mark.asyncio
async def test_fuzzy_match_above_threshold(fake_redis) -> None:  # noqa: ARG001
    await tm.store("The quarterly revenue report is ready", "en", "ja", "四半期売上報告書")
    # 1 語違い（report→reports）でも高類似で fuzzy 命中。
    hit = await tm.lookup("The quarterly revenue reports is ready", "en", "ja")
    assert hit == "四半期売上報告書"


@pytest.mark.asyncio
async def test_fuzzy_miss_below_threshold(fake_redis) -> None:  # noqa: ARG001
    await tm.store("The quarterly revenue report is ready", "en", "ja", "四半期売上報告書")
    assert await tm.lookup("Completely different sentence here", "en", "ja") is None


@pytest.mark.asyncio
async def test_cjk_source_disables_fuzzy(fake_redis) -> None:  # noqa: ARG001
    """無空格 CJK 源は fuzzy を行わない（「起動」vs「再起動」の誤流用防止）。"""
    await tm.store("システムを起動します", "ja", "en", "start the system")
    # 1 文字差だが意味は反転（restart）。fuzzy 無効で誤ヒットしない。
    assert await tm.lookup("システムを再起動します", "ja", "en") is None
    # 完全一致は引ける（正規化 exact）。
    assert await tm.lookup("システムを起動します", "ja", "en") == "start the system"


@pytest.mark.asyncio
async def test_fuzzy_length_guard_excludes_divergent(fake_redis) -> None:  # noqa: ARG001
    """長さが大きく異なる候補は fuzzy 対象外（挿入で意味反転する近似句を除外）。"""
    await tm.store("ok", "en", "ja", "はい")  # 短すぎ→未登録
    await tm.store("The meeting is scheduled for today", "en", "ja", "会議は本日予定")
    # 大幅に長い別文は長さ比ガードで除外され None。
    assert (
        await tm.lookup(
            "The meeting is scheduled for today and tomorrow and next week too",
            "en",
            "ja",
        )
        is None
    )


@pytest.mark.asyncio
async def test_language_pair_isolation(fake_redis) -> None:  # noqa: ARG001
    await tm.store("Hello world", "en", "ja", "こんにちは世界")
    # 別言語対では引けない。
    assert await tm.lookup("Hello world", "en", "zh") is None


@pytest.mark.asyncio
async def test_version_isolation(fake_redis) -> None:  # noqa: ARG001
    await tm.store("Hello world", "en", "ja", "旧訳", version="1")
    # 用語集世代が変わると旧 TM は無効（新世代では未登録）。
    assert await tm.lookup("Hello world", "en", "ja", version="2") is None
    assert await tm.lookup("Hello world", "en", "ja", version="1") == "旧訳"


@pytest.mark.asyncio
async def test_short_text_skipped(fake_redis) -> None:  # noqa: ARG001
    await tm.store("hi", "en", "ja", "やあ")
    # 最小文字数未満は TM 対象外（exact cache に委ねる）。
    assert await tm.lookup("hi", "en", "ja") is None


@pytest.mark.asyncio
async def test_empty_translation_not_stored(fake_redis) -> None:  # noqa: ARG001
    await tm.store("Hello world", "en", "ja", "")
    assert await tm.lookup("Hello world", "en", "ja") is None


@pytest.mark.asyncio
async def test_lookup_degrades_on_redis_error(monkeypatch) -> None:
    async def boom() -> object:
        raise RuntimeError("redis down")

    monkeypatch.setattr(tm, "_get_redis", boom)
    # 障害時は None に縮退し例外を投げない。
    assert await tm.lookup("Hello world", "en", "ja") is None
