"""Golden Test（改善.md §15 最低品質ゲート）のシード検証。

目的:
    数字・日付・金額の保持率（≥98%）と用語命中率（≥95%）の品質ゲートを、
    オフラインのシードデータ（tests/fixtures/golden_set.json）で実行可能にする。
    各ケースは good（合格訳）と bad（ゲートが検知すべき改悪訳）を持ち、
    ゲート関数が good を通し bad を弾くことを検証する。
方針:
    音声・ASR・実翻訳 API には依存しない（純ロジックのみ）。実翻訳の評価へ拡張する
    際は good/bad を実出力へ差し替え、同じ number_retention / glossary 関数へ通す。
"""

import json
from dataclasses import dataclass
from pathlib import Path

from app.ai_pipeline.qos import NUMBER_RETENTION_TARGET, number_retention
from app.translate.glossary import match_terms, measure_glossary_hits

_GOLDEN = json.loads(
    (Path(__file__).parent / "fixtures" / "golden_set.json").read_text(encoding="utf-8")
)


@dataclass
class _Term:
    """match_terms が要求する用語の最小実装（DB 非依存）。"""

    source_term: str
    target_term: str | None
    do_not_translate: bool
    source_language: str
    target_language: str
    priority: int = 100
    enabled: bool = True


def test_number_cases_good_passes_bad_fails() -> None:
    """数字保持: good は目標以上、bad は目標未満をゲートが検知する"""
    for case in _GOLDEN["number_cases"]:
        good = number_retention(case["source"], case["good"])
        bad = number_retention(case["source"], case["bad"])
        assert good is not None and good >= NUMBER_RETENTION_TARGET, case["source"]
        assert bad is not None and bad < NUMBER_RETENTION_TARGET, case["source"]


def test_glossary_cases_good_passes_bad_fails() -> None:
    """用語命中: good は全命中、bad は命中数が減ることをゲートが検知する"""
    for case in _GOLDEN["glossary_cases"]:
        terms = [
            _Term(
                source_term=t["source_term"],
                target_term=t["target_term"],
                do_not_translate=t["do_not_translate"],
                source_language=case["source_language"],
                target_language=case["target_language"],
            )
            for t in case["terms"]
        ]
        matches = match_terms(
            case["source"], terms, case["source_language"], case["target_language"]
        )
        assert matches, f"用語が検出されない: {case['source']}"

        good_hits, total = measure_glossary_hits(matches, case["good"])
        bad_hits, _ = measure_glossary_hits(matches, case["bad"])
        assert good_hits == total, f"good 訳で用語未反映: {case['good']}"
        assert bad_hits < total, f"bad 訳をゲートが見逃した: {case['bad']}"
