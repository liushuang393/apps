"""A/B テスト配信（P4-C）の純ロジック単体テスト：決定的割当・重み・登録簿・設定解析。"""

import pytest

from app.ai_pipeline import ab_testing
from app.ai_pipeline.ab_testing import (
    Experiment,
    ExperimentRegistry,
    ExperimentVariant,
    assign,
    build_experiment_registry,
    resolve_unit_id,
)


def _exp(**kw) -> Experiment:
    """テスト用の 2 群実験を生成する。"""
    return Experiment(
        key=kw.get("key", "exp1"),
        stage=kw.get("stage", "asr"),
        variants=kw.get(
            "variants",
            (
                ExperimentVariant("control", "m-control", 50),
                ExperimentVariant("treatment", "m-treatment", 50),
            ),
        ),
        unit=kw.get("unit", "session"),
        enabled=kw.get("enabled", True),
    )


# ---- バリデーション ----


def test_variant_rejects_bad_weight() -> None:
    """weight<=0 は ValueError。"""
    with pytest.raises(ValueError):
        ExperimentVariant("v", "m", 0)


def test_experiment_rejects_unknown_stage() -> None:
    """未知 stage は ValueError。"""
    with pytest.raises(ValueError):
        _exp(stage="unknown")


def test_experiment_rejects_duplicate_variant_names() -> None:
    """variant.name 重複は ValueError。"""
    with pytest.raises(ValueError):
        _exp(
            variants=(
                ExperimentVariant("a", "m1", 1),
                ExperimentVariant("a", "m2", 1),
            )
        )


def test_experiment_rejects_empty_variants() -> None:
    """variants 空は ValueError。"""
    with pytest.raises(ValueError):
        _exp(variants=())


# ---- assign（決定性・分布） ----


def test_assign_is_deterministic() -> None:
    """同一 (key, unit_id) は常に同じ variant を返す。"""
    exp = _exp()
    first = assign(exp, "unit-123")
    for _ in range(20):
        assert assign(exp, "unit-123") is first


def test_assign_disabled_returns_none() -> None:
    """無効実験は None。"""
    assert assign(_exp(enabled=False), "u1") is None


def test_assign_missing_unit_returns_none() -> None:
    """unit_id 欠落は None。"""
    assert assign(_exp(), None) is None
    assert assign(_exp(), "") is None


def test_assign_single_variant_always_selected() -> None:
    """群が 1 つなら必ずそれ。"""
    exp = _exp(variants=(ExperimentVariant("only", "m", 5),))
    assert assign(exp, "anything").name == "only"


def test_assign_respects_weight_distribution() -> None:
    """重み 90:10 でおおむね偏った配信になる（決定的ハッシュの分布確認）。"""
    exp = _exp(
        variants=(
            ExperimentVariant("big", "m-big", 90),
            ExperimentVariant("small", "m-small", 10),
        )
    )
    counts = {"big": 0, "small": 0}
    for i in range(1000):
        v = assign(exp, f"user-{i}")
        counts[v.name] += 1
    # 90:10 の期待に対し big が明確に多数（分布の健全性のみ確認）。
    assert counts["big"] > counts["small"] * 3
    assert counts["small"] > 0  # small も 0 ではない


def test_assign_zero_total_weight_guarded() -> None:
    """重み総和が正であることは __post_init__ が担保（ここでは正常系の総和を確認）。"""
    exp = _exp()
    assert exp.total_weight == 100


# ---- resolve_unit_id ----


def test_resolve_unit_id_by_unit() -> None:
    """unit に応じた id を選ぶ。"""
    assert (
        resolve_unit_id(_exp(unit="room"), room_id="r", user_id="u", session_id="s")
        == "r"
    )
    assert (
        resolve_unit_id(_exp(unit="user"), room_id="r", user_id="u", session_id="s")
        == "u"
    )
    assert (
        resolve_unit_id(
            _exp(unit="session"), room_id="r", user_id="u", session_id="s"
        )
        == "s"
    )


# ---- ExperimentRegistry ----


def test_registry_register_get_for_stage() -> None:
    """登録・取得・stage 索引・enabled_only フィルタ。"""
    reg = ExperimentRegistry()
    a = _exp(key="a", stage="asr")
    b = _exp(key="b", stage="t2t", enabled=False)
    reg.register(a)
    reg.register(b)
    assert reg.get("a") is a
    assert reg.for_stage("asr") == [a]
    assert reg.for_stage("t2t") == []  # enabled_only 既定で無効は除外
    assert reg.for_stage("t2t", enabled_only=False) == [b]
    assert len(reg.list()) == 2


def test_registry_overwrite_updates_stage_index() -> None:
    """同一 key 上書きで stage が変わっても索引が二重化しない。"""
    reg = ExperimentRegistry()
    reg.register(_exp(key="x", stage="asr"))
    reg.register(_exp(key="x", stage="t2t"))
    assert reg.for_stage("asr") == []
    assert [e.key for e in reg.for_stage("t2t")] == ["x"]
    assert len(reg.list()) == 1


# ---- build_experiment_registry（設定解析・fail-safe） ----


def test_build_disabled_returns_empty(monkeypatch) -> None:
    """enable_ab_testing=False なら空。"""
    monkeypatch.setattr(ab_testing.settings, "enable_ab_testing", False)
    assert build_experiment_registry().list() == []


def test_build_parses_valid_config(monkeypatch) -> None:
    """有効な JSON 設定から実験を構築する。"""
    monkeypatch.setattr(ab_testing.settings, "enable_ab_testing", True)
    monkeypatch.setattr(
        ab_testing.settings,
        "experiments_config",
        '[{"key":"e1","stage":"asr","unit":"session","enabled":true,'
        '"variants":[{"name":"c","model_id":"m1","weight":1},'
        '{"name":"t","model_id":"m2","weight":1}]}]',
    )
    reg = build_experiment_registry()
    e1 = reg.get("e1")
    assert e1 is not None
    assert e1.stage == "asr" and len(e1.variants) == 2


def test_build_bad_json_returns_empty(monkeypatch) -> None:
    """JSON 不正は fail-safe で空（例外を投げない）。"""
    monkeypatch.setattr(ab_testing.settings, "enable_ab_testing", True)
    monkeypatch.setattr(ab_testing.settings, "experiments_config", "{not json")
    assert build_experiment_registry().list() == []


def test_build_skips_invalid_experiment_keeps_valid(monkeypatch) -> None:
    """不正な実験のみスキップし、正しい実験は残す。"""
    monkeypatch.setattr(ab_testing.settings, "enable_ab_testing", True)
    monkeypatch.setattr(
        ab_testing.settings,
        "experiments_config",
        "["
        '{"key":"bad","stage":"NOPE","variants":[]},'
        '{"key":"good","stage":"t2t","variants":'
        '[{"name":"c","model_id":"m","weight":1}]}'
        "]",
    )
    reg = build_experiment_registry()
    assert reg.get("bad") is None
    assert reg.get("good") is not None


def test_build_non_array_returns_empty(monkeypatch) -> None:
    """配列でない JSON は空。"""
    monkeypatch.setattr(ab_testing.settings, "enable_ab_testing", True)
    monkeypatch.setattr(ab_testing.settings, "experiments_config", '{"key":"x"}')
    assert build_experiment_registry().list() == []
