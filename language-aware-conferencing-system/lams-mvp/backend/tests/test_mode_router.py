"""
ModeRouter（Phase 3 ハイブリッド主線選択）の単体テスト。

純ロジック（I/O 非依存）であることを前提に、会議モード・S2S 許可・言語ペア
上書き・可用性縮退の各分岐を網羅する。
"""

from app.ai_pipeline.mode_router import ModeRouter, RouteContext

router = ModeRouter()


def test_hybrid_all_available_drives_both_mainlines() -> None:
    """hybrid + 翻訳必要 + 両主線可用 → 聞く/読む両方を駆動。"""
    d = router.decide(
        RouteContext(mode="hybrid", source_language="ja", target_language="en")
    )
    assert d.run_hearing is True
    assert d.run_reading is True
    assert d.needs_translation is True
    assert d.reason == "hybrid"


def test_mode_a_drives_hearing_only() -> None:
    """mode A → 聞く主線のみ。"""
    d = router.decide(
        RouteContext(mode="a", source_language="ja", target_language="en")
    )
    assert d.run_hearing is True
    assert d.run_reading is False


def test_mode_b_drives_reading_only() -> None:
    """mode B → 読む主線のみ。"""
    d = router.decide(
        RouteContext(mode="b", source_language="ja", target_language="en")
    )
    assert d.run_hearing is False
    assert d.run_reading is True


def test_same_language_skips_translation_keeps_reading_for_records() -> None:
    """同一言語 → 翻訳不要。聞く主線は走らせず、読む主線は記録目的で継続。"""
    d = router.decide(
        RouteContext(mode="hybrid", source_language="ja", target_language="ja")
    )
    assert d.needs_translation is False
    assert d.run_hearing is False
    assert d.run_reading is True
    assert d.reason == "same_language_no_translation"


def test_disabling_s2s_degrades_hybrid_to_reading() -> None:
    """会議レベルで S2S 不許可 → hybrid でも読む主線のみ。"""
    d = router.decide(
        RouteContext(
            mode="hybrid",
            source_language="ja",
            target_language="en",
            enable_openai_s2s=False,
        )
    )
    assert d.run_hearing is False
    assert d.run_reading is True


def test_s2s_unavailable_falls_back_to_reading() -> None:
    """mode A で S2S 不可 → 読む主線へ縮退（可聴性確保）。"""
    d = router.decide(
        RouteContext(
            mode="a",
            source_language="ja",
            target_language="en",
            s2s_available=False,
        )
    )
    assert d.run_hearing is False
    assert d.run_reading is True
    assert d.reason == "s2s_unavailable_fallback_reading"


def test_reading_unavailable_falls_back_to_hearing() -> None:
    """hybrid で読む主線不可かつ聞く主線可 → 字幕は S2S delta で代替。"""
    d = router.decide(
        RouteContext(
            mode="hybrid",
            source_language="ja",
            target_language="en",
            reading_available=False,
        )
    )
    assert d.run_hearing is True
    assert d.run_reading is False
    assert d.reason == "reading_unavailable_fallback_hearing"


def test_language_route_override_changes_mode() -> None:
    """language_routes の mode 上書きが会議既定より優先される。"""
    d = router.decide(
        RouteContext(
            mode="hybrid",
            source_language="ja",
            target_language="en",
            language_routes={"ja->en": {"mode": "b"}},
        )
    )
    assert d.run_hearing is False
    assert d.run_reading is True


def test_language_route_override_passes_s2s_provider() -> None:
    """language_routes の s2s_provider 上書きが decision に伝播する。"""
    d = router.decide(
        RouteContext(
            mode="a",
            source_language="en",
            target_language="ja",
            language_routes={"en->ja": {"s2s_provider": "gemini_live"}},
        )
    )
    assert d.run_hearing is True
    assert d.s2s_provider == "gemini_live"


def test_region_suffix_is_normalized_for_routing() -> None:
    """地域サフィックス付き（ja-JP）でも基底コードで照合・翻訳判定する。"""
    d = router.decide(
        RouteContext(mode="hybrid", source_language="ja-JP", target_language="ja")
    )
    assert d.needs_translation is False
