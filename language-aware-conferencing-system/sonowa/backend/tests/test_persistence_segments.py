"""segment 永続化の純ロジック（_providers_by_lang）の単体テスト。

対象: app.webrtc.persistence._providers_by_lang。
方針: DB 非依存。orchestrator の tags から TranslationSegment.provider を導出する
規則（聞く主線→S2S provider / 読む主線→"asr_mt" / 字幕なし→None）を検証する。
"""

from app.webrtc.persistence import _providers_by_lang


def test_empty_tags_returns_empty() -> None:
    """tags が空なら空 dict"""
    assert _providers_by_lang([]) == {}


def test_hearing_uses_s2s_provider() -> None:
    """聞く主線は s2s_provider を採用する"""
    tags = [
        {
            "target_language": "ja",
            "subtitle_mainline": "hearing",
            "s2s_provider": "gemini_live",
        }
    ]
    assert _providers_by_lang(tags) == {"ja": "gemini_live"}


def test_reading_uses_asr_mt() -> None:
    """読む主線は "asr_mt" 固定"""
    tags = [
        {
            "target_language": "en",
            "subtitle_mainline": "reading",
            "s2s_provider": None,
        }
    ]
    assert _providers_by_lang(tags) == {"en": "asr_mt"}


def test_no_subtitle_provider_is_none() -> None:
    """字幕なし（subtitle_mainline=None）は provider None（hearing 以外なので asr_mt 扱い）"""
    # subtitle_mainline が hearing でなければ asr_mt（読む主線既定）になる
    tags = [{"target_language": "zh", "subtitle_mainline": None, "s2s_provider": None}]
    assert _providers_by_lang(tags) == {"zh": "asr_mt"}


def test_skips_tag_without_target_language() -> None:
    """target_language 欠落タグは無視する"""
    tags = [{"subtitle_mainline": "hearing", "s2s_provider": "x"}]
    assert _providers_by_lang(tags) == {}
