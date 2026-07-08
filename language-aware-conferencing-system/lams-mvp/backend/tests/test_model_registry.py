"""
モデル注册表（Model Registry / 治理層）単体テスト

対象: app.ai_pipeline.model_registry
方針:
    - DB・ネットワーク・API キー非依存（治理カタログはメタ情報のみ）。
    - register/get/list・ライフサイクル遷移・production_for・商用可否・
      ModelCard 不変条件・既定カタログ seed を検証する。
"""

import pytest

from app.ai_pipeline.model_registry import (
    RUNTIME_CLOUD,
    RUNTIME_CT2,
    STAGE_ASR,
    STAGE_T2T,
    STAGE_TTS,
    STATUS_DEPRECATED,
    STATUS_DRAFT,
    STATUS_PRODUCTION,
    STATUS_STAGING,
    ModelCard,
    ModelCatalog,
    model_catalog,
    production_provider_name,
)


def _make_card(
    model_id: str = "m1",
    *,
    stage: str = STAGE_T2T,
    runtime: str = RUNTIME_CT2,
    languages: list[str] | None = None,
    license: str = "apache-2.0",
    status: str = STATUS_DRAFT,
    metrics: dict[str, float] | None = None,
) -> ModelCard:
    """テスト用 ModelCard 生成ヘルパ。"""
    return ModelCard(
        model_id=model_id,
        stage=stage,
        base_model="base",
        runtime=runtime,
        quantization="int8",
        languages=languages if languages is not None else ["ja", "en"],
        license=license,
        hardware_profile="cpu",
        metrics=metrics if metrics is not None else {"quality": 0.5},
        created_at="2026-01-01T00:00:00+00:00",
        approved_by=None,
        status=status,
    )


# ============================================================
# register / get / list
# ============================================================
def test_register_and_get() -> None:
    cat = ModelCatalog()
    card = _make_card("a")
    cat.register(card)
    assert cat.get("a") is card
    assert cat.get("missing") is None


def test_list_filters_by_stage_status_language() -> None:
    cat = ModelCatalog()
    cat.register(_make_card("asr1", stage=STAGE_ASR, languages=["ja"]))
    cat.register(
        _make_card(
            "t2t1", stage=STAGE_T2T, languages=["en"], status=STATUS_PRODUCTION
        )
    )
    cat.register(_make_card("t2t2", stage=STAGE_T2T, languages=["ja", "vi"]))

    assert {c.model_id for c in cat.list(stage=STAGE_T2T)} == {"t2t1", "t2t2"}
    assert [c.model_id for c in cat.list(status=STATUS_PRODUCTION)] == ["t2t1"]
    assert {c.model_id for c in cat.list(language="ja")} == {"asr1", "t2t2"}
    # フィルタ合成（AND）
    assert [c.model_id for c in cat.list(stage=STAGE_T2T, language="vi")] == ["t2t2"]
    assert cat.list(stage=STAGE_ASR, status=STATUS_PRODUCTION) == []


# ============================================================
# set_status（ライフサイクル遷移）
# ============================================================
@pytest.mark.parametrize(
    ("start", "target"),
    [
        (STATUS_DRAFT, STATUS_STAGING),
        (STATUS_STAGING, STATUS_PRODUCTION),
        (STATUS_STAGING, STATUS_DRAFT),
        (STATUS_PRODUCTION, STATUS_DEPRECATED),
        (STATUS_STAGING, STATUS_DEPRECATED),
        (STATUS_DRAFT, STATUS_DEPRECATED),
    ],
)
def test_set_status_allowed_transitions(start: str, target: str) -> None:
    cat = ModelCatalog()
    cat.register(_make_card("m", status=start))
    updated = cat.set_status("m", target)
    assert updated.status == target
    assert cat.get("m").status == target


@pytest.mark.parametrize(
    ("start", "target"),
    [
        (STATUS_DRAFT, STATUS_PRODUCTION),  # staging を飛ばす
        (STATUS_DEPRECATED, STATUS_PRODUCTION),  # 復活禁止
        (STATUS_DEPRECATED, STATUS_STAGING),
        (STATUS_PRODUCTION, STATUS_STAGING),  # 逆行禁止
        (STATUS_PRODUCTION, STATUS_DRAFT),
    ],
)
def test_set_status_forbidden_transitions(start: str, target: str) -> None:
    cat = ModelCatalog()
    cat.register(_make_card("m", status=start))
    with pytest.raises(ValueError):
        cat.set_status("m", target)
    # 失敗時は状態を変えない
    assert cat.get("m").status == start


def test_set_status_unknown_model_raises_keyerror() -> None:
    cat = ModelCatalog()
    with pytest.raises(KeyError):
        cat.set_status("nope", STATUS_STAGING)


def test_set_status_unknown_status_raises_valueerror() -> None:
    cat = ModelCatalog()
    cat.register(_make_card("m", status=STATUS_DRAFT))
    with pytest.raises(ValueError):
        cat.set_status("m", "published")


# ============================================================
# production_for
# ============================================================
def test_production_for_returns_matching_production_card() -> None:
    cat = ModelCatalog()
    cat.register(
        _make_card(
            "prod", stage=STAGE_T2T, languages=["ja"], status=STATUS_PRODUCTION
        )
    )
    got = cat.production_for(STAGE_T2T, "ja")
    assert got is not None
    assert got.model_id == "prod"


def test_production_for_none_when_no_match() -> None:
    cat = ModelCatalog()
    # production だが言語不一致
    cat.register(
        _make_card(
            "prod", stage=STAGE_T2T, languages=["en"], status=STATUS_PRODUCTION
        )
    )
    # 言語一致だが staging
    cat.register(
        _make_card("stg", stage=STAGE_T2T, languages=["ja"], status=STATUS_STAGING)
    )
    assert cat.production_for(STAGE_T2T, "ja") is None
    assert cat.production_for(STAGE_ASR, "en") is None


def test_production_for_picks_highest_quality() -> None:
    cat = ModelCatalog()
    cat.register(
        _make_card(
            "low",
            stage=STAGE_T2T,
            languages=["ja"],
            status=STATUS_PRODUCTION,
            metrics={"quality": 0.7},
        )
    )
    cat.register(
        _make_card(
            "high",
            stage=STAGE_T2T,
            languages=["ja"],
            status=STATUS_PRODUCTION,
            metrics={"quality": 0.9},
        )
    )
    got = cat.production_for(STAGE_T2T, "ja")
    assert got is not None
    assert got.model_id == "high"


# ============================================================
# is_commercial_allowed
# ============================================================
@pytest.mark.parametrize(
    ("license_text", "expected"),
    [
        ("cc-by-nc-4.0", False),
        ("CC-BY-NC", False),
        ("Non-Commercial", False),
        ("noncommercial research only", False),
        ("apache-2.0", True),
        ("MIT", True),
        ("cc-by-4.0", True),
        ("proprietary", True),
    ],
)
def test_is_commercial_allowed(license_text: str, expected: bool) -> None:
    cat = ModelCatalog()
    card = _make_card(license=license_text)
    assert cat.is_commercial_allowed(card) is expected


# ============================================================
# ModelCard 不変条件
# ============================================================
def test_model_card_rejects_unknown_stage() -> None:
    with pytest.raises(ValueError):
        _make_card(stage="unknown-stage")


def test_model_card_rejects_unknown_status() -> None:
    with pytest.raises(ValueError):
        _make_card(status="published")


def test_model_card_rejects_unknown_runtime() -> None:
    with pytest.raises(ValueError):
        _make_card(runtime="tensorrt")


# ============================================================
# 既定カタログ（seed）
# ============================================================
@pytest.mark.parametrize("stage", [STAGE_ASR, STAGE_T2T, STAGE_TTS])
def test_default_catalog_has_production_for_core_stages(stage: str) -> None:
    prods = model_catalog.list(stage=stage, status=STATUS_PRODUCTION)
    assert prods, f"{stage} に production カードが存在すること"


def test_default_catalog_cloud_cards_are_production() -> None:
    # cloud プロバイダーは production 方針（asr/t2t/tts 各 1 件以上）。
    asr = model_catalog.production_for(STAGE_ASR, "ja")
    t2t = model_catalog.production_for(STAGE_T2T, "en")
    tts = model_catalog.production_for(STAGE_TTS, "zh")
    assert asr is not None and asr.runtime == RUNTIME_CLOUD
    assert t2t is not None and t2t.runtime == RUNTIME_CLOUD
    assert tts is not None and tts.runtime == RUNTIME_CLOUD


def test_default_catalog_nllb_is_non_commercial_and_draft() -> None:
    # NLLB（CC-BY-NC）は商用不可かつ draft 留め（§4.3）。
    nllb = model_catalog.get("t2t-nllb-200")
    assert nllb is not None
    assert nllb.status == STATUS_DRAFT
    assert model_catalog.is_commercial_allowed(nllb) is False


# ============================================================
# ランタイム選択ブリッジ（production_provider_name / P4-wiring）
# ============================================================
def test_production_provider_name_maps_registry_stages() -> None:
    # registry ステージ名（asr/mt/tts）→ production カードの provider_name。
    # mt は本カタログの t2t へ対応づける（歴史的な stage 名差異を吸収）。
    assert production_provider_name("asr", "ja") == "gpt4o"
    assert production_provider_name("mt", "en") == "openai"
    assert production_provider_name("tts", "zh") == "openai"


def test_production_provider_name_unknown_stage_returns_none() -> None:
    # registry スロットに対応しないステージは None（呼び出し側で既定へ縮退）。
    assert production_provider_name("vad", "ja") is None
    assert production_provider_name("bogus", "ja") is None


def test_seed_production_cards_have_provider_name() -> None:
    # 主要 3 ステージの production カードは実行時スロット名を持つ。
    assert model_catalog.production_for(STAGE_ASR, "ja").provider_name == "gpt4o"
    assert model_catalog.production_for(STAGE_T2T, "ja").provider_name == "openai"
    assert model_catalog.production_for(STAGE_TTS, "ja").provider_name == "openai"
