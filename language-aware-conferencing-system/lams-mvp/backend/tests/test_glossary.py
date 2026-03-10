"""
用語集エンジン 単体テスト

対象: app.translate.glossary の純粋関数（match_terms / build_prompt_hint）。
方針: DB・ネットワーク非依存。軽量なダミー用語オブジェクトで照合規則を検証する。
"""

from dataclasses import dataclass

from app.translate.glossary import (
    GlossaryMatch,
    build_prompt_hint,
    match_terms,
)


@dataclass
class DummyTerm:
    """match_terms 用のテスト用語（ORM 非依存）"""

    source_term: str
    target_term: str | None = None
    do_not_translate: bool = False
    priority: int = 100
    enabled: bool = True
    source_language: str = "ja"
    target_language: str = "zh"


def test_match_basic_hit() -> None:
    """言語ペア一致かつ部分一致する用語を抽出する"""
    terms = [DummyTerm(source_term="承認フロー", target_term="审批流程")]
    result = match_terms("この承認フローを確認", terms, "ja", "zh")
    assert len(result) == 1
    assert result[0].source_term == "承認フロー"
    assert result[0].target_term == "审批流程"


def test_match_no_hit_when_absent() -> None:
    """テキストに存在しない用語は抽出されない"""
    terms = [DummyTerm(source_term="承認フロー", target_term="审批流程")]
    assert match_terms("天気の話", terms, "ja", "zh") == []


def test_match_filters_language_pair() -> None:
    """言語ペアが異なる用語は対象外"""
    terms = [
        DummyTerm(source_term="apple", target_term="苹果", source_language="en"),
    ]
    assert match_terms("apple pie", terms, "ja", "zh") == []
    assert len(match_terms("apple pie", terms, "en", "zh")) == 1


def test_match_region_tolerant_language() -> None:
    """region 付き言語コード（ja-JP）も基底言語で照合される"""
    terms = [
        DummyTerm(
            source_term="承認",
            target_term="审批",
            source_language="ja-JP",
            target_language="zh-CN",
        )
    ]
    assert len(match_terms("承認する", terms, "ja", "zh")) == 1


def test_match_case_insensitive() -> None:
    """ラテン語は大小文字を無視して照合する"""
    terms = [DummyTerm(source_term="API", target_term="接口", source_language="en")]
    assert len(match_terms("call the api now", terms, "en", "zh")) == 1


def test_match_disabled_excluded() -> None:
    """無効化された用語は抽出されない"""
    terms = [DummyTerm(source_term="承認", target_term="审批", enabled=False)]
    assert match_terms("承認", terms, "ja", "zh") == []


def test_match_priority_and_dedup() -> None:
    """同一 source_term は最高 priority の 1 件のみ残す"""
    terms = [
        DummyTerm(source_term="部長", target_term="A", priority=10),
        DummyTerm(source_term="部長", target_term="B", priority=200),
    ]
    result = match_terms("部長", terms, "ja", "zh")
    assert len(result) == 1
    assert result[0].target_term == "B"


def test_match_sorted_by_priority_desc() -> None:
    """複数命中時は priority 降順で並ぶ"""
    terms = [
        DummyTerm(source_term="承認", target_term="审批", priority=50),
        DummyTerm(source_term="部長", target_term="部长", priority=150),
    ]
    result = match_terms("部長が承認", terms, "ja", "zh")
    assert [m.source_term for m in result] == ["部長", "承認"]


def test_build_hint_empty() -> None:
    """命中なしのヒントは空文字"""
    assert build_prompt_hint([]) == ""


def test_build_hint_translation_term() -> None:
    """指定訳ありの用語は MUST be translated as 文を生成"""
    hint = build_prompt_hint(
        [GlossaryMatch("承認", "审批", do_not_translate=False, priority=100)]
    )
    assert '"承認"' in hint
    assert '"审批"' in hint
    assert "MUST be translated" in hint


def test_build_hint_do_not_translate() -> None:
    """翻訳禁止語は keep unchanged 文を生成"""
    hint = build_prompt_hint(
        [GlossaryMatch("LAMS", None, do_not_translate=True, priority=100)]
    )
    assert '"LAMS"' in hint
    assert "do NOT translate" in hint
