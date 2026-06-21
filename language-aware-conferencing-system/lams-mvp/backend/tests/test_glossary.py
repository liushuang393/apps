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
    measure_glossary_hits,
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


def test_measure_hits_empty_returns_zero() -> None:
    """命中用語が無ければ (0, 0)（命中率計測の分母なし）"""
    assert measure_glossary_hits([], "any text") == (0, 0)


def test_measure_hits_target_term_present() -> None:
    """指定訳が訳文に出現すれば命中"""
    matches = [GlossaryMatch("承認", "审批", do_not_translate=False, priority=100)]
    assert measure_glossary_hits(matches, "请进行审批操作") == (1, 1)


def test_measure_hits_target_term_absent() -> None:
    """指定訳が訳文に無ければ非命中"""
    matches = [GlossaryMatch("承認", "审批", do_not_translate=False, priority=100)]
    assert measure_glossary_hits(matches, "请进行确认操作") == (0, 1)


def test_measure_hits_do_not_translate_preserved() -> None:
    """翻訳禁止語は source_term が訳文に保持されていれば命中"""
    matches = [GlossaryMatch("LAMS", None, do_not_translate=True, priority=100)]
    assert measure_glossary_hits(matches, "LAMS は便利です") == (1, 1)


def test_measure_hits_case_insensitive() -> None:
    """訳文の照合は大小文字を無視する"""
    matches = [GlossaryMatch("api", "API", do_not_translate=False, priority=100)]
    assert measure_glossary_hits(matches, "call the api endpoint") == (1, 1)


def test_measure_hits_partial_ratio() -> None:
    """複数候補のうち反映分のみ命中（命中率の分子/分母）"""
    matches = [
        GlossaryMatch("承認", "审批", do_not_translate=False, priority=100),
        GlossaryMatch("部長", "部长", do_not_translate=False, priority=100),
    ]
    assert measure_glossary_hits(matches, "审批を依頼") == (1, 2)
