"""
モデル注册表（Model Registry / 治理層）

目的:
    改善案 §5.1 のモデル/adapter カタログ治理を担う。各ステージ（vad / asr /
    diarization / t2t / tts / summary）で「どのモデルを・どの量子化で・どの
    ハードウェアで・どのライセンスで」運用しているかを ModelCard として一元管理
    し、draft→staging→production→deprecated のライフサイクル遷移を検証する。
入力 / 出力:
    config.py の既存モデル名（openai_* / local_* / gemini_live_model）を初期
    カードとして seed し、ステージ×言語で production モデルを引ける。
責務境界（重要）:
    本モジュールは「治理カタログ」のみを扱い、実行時のステージ実体は解決しない。
    実体解決は registry.py（ProviderRegistry）の責務であり相互 import しない
    （registry.py＝実行時の実体解決、model_registry.py＝カタログ治理）。
注意点:
    商用可否は license の NC マーカーで判定（NLLB の CC-BY-NC を商用不可へ倒す。
    §4.3）。print 禁止・logging 使用。
"""

import logging
from dataclasses import dataclass
from datetime import datetime, timezone

from app.config import settings

logger = logging.getLogger(__name__)

# ============================================================
# 定数（既知集合。ModelCard / 遷移検証はこれらに閉じる）
# ============================================================
# ステージ（改善案 §5.1 のパイプライン段階）
STAGE_VAD = "vad"
STAGE_ASR = "asr"
STAGE_DIARIZATION = "diarization"
STAGE_T2T = "t2t"
STAGE_TTS = "tts"
STAGE_SUMMARY = "summary"
STAGES: frozenset[str] = frozenset(
    {STAGE_VAD, STAGE_ASR, STAGE_DIARIZATION, STAGE_T2T, STAGE_TTS, STAGE_SUMMARY}
)

# ライフサイクル状態
STATUS_DRAFT = "draft"
STATUS_STAGING = "staging"
STATUS_PRODUCTION = "production"
STATUS_DEPRECATED = "deprecated"
STATUSES: frozenset[str] = frozenset(
    {STATUS_DRAFT, STATUS_STAGING, STATUS_PRODUCTION, STATUS_DEPRECATED}
)

# ランタイム（実行基盤。cloud も 1 ランタイムとして扱う）
RUNTIME_CT2 = "ct2"
RUNTIME_FASTER_WHISPER = "faster_whisper"
RUNTIME_LLAMA_CPP = "llama_cpp"
RUNTIME_ONNX = "onnx"
RUNTIME_CLOUD = "cloud"
RUNTIMES: frozenset[str] = frozenset(
    {RUNTIME_CT2, RUNTIME_FASTER_WHISPER, RUNTIME_LLAMA_CPP, RUNTIME_ONNX, RUNTIME_CLOUD}
)

# 許可されるライフサイクル遷移（それ以外は ValueError）。staging→draft は差し戻し。
# 禁止例: draft→production（staging 検証を飛ばす）, deprecated→*（復活禁止）,
# production→staging/draft（逆行）。
_ALLOWED_TRANSITIONS: dict[str, frozenset[str]] = {
    STATUS_DRAFT: frozenset({STATUS_STAGING, STATUS_DEPRECATED}),
    STATUS_STAGING: frozenset({STATUS_PRODUCTION, STATUS_DRAFT, STATUS_DEPRECATED}),
    STATUS_PRODUCTION: frozenset({STATUS_DEPRECATED}),
    STATUS_DEPRECATED: frozenset(),
}

# 非商用（研究のみ）を示すライセンス・マーカー。lower-case 化した license に
# いずれかを含めば商用不可と判定する。裸の "nc" 部分一致は誤検出（"license" 等）を
# 招くため採らず、区切り付きの NC マーカーで判定する（例: CC-BY-NC → "cc-by-nc"）。
_NON_COMMERCIAL_MARKERS: tuple[str, ...] = (
    "non-commercial",
    "noncommercial",
    "cc-by-nc",
)

# production_for が優先する metrics キー（高いほど良い）。先頭優先で探索する。
_QUALITY_METRIC_KEYS: tuple[str, ...] = ("quality", "bleu", "wer_inv", "accuracy")


@dataclass
class ModelCard:
    """
    モデル 1 件分の治理カード（改善案 §5.1）。フィールド:
    model_id: 一意な識別子（例: "asr-whisper-large-v3-turbo"）
    stage: STAGES のいずれか
    base_model: ベースモデル名（config のモデル名を含む）
    runtime: RUNTIMES のいずれか（cloud も含む）
    quantization: 量子化方式（int8 等。cloud は None 可）
    languages: 対応言語コード一覧（例: ["ja", "en"]）
    license: ライセンス表記（商用可否判定に使用）
    hardware_profile: 想定ハードウェア（例: "gpu-12gb" / "cpu" / "cloud-api"）
    metrics: 品質/遅延などの指標（例: {"quality": 0.9, "latency_ms": 300}）
    created_at: カード作成時刻（ISO8601 文字列）
    approved_by: 承認者（未承認は None） / status: STATUSES（ライフサイクル状態）
    """

    model_id: str
    stage: str
    base_model: str
    runtime: str
    quantization: str | None
    languages: list[str]
    license: str
    hardware_profile: str
    metrics: dict[str, float]
    created_at: str
    approved_by: str | None
    status: str
    # registry.py（ProviderRegistry）の実行時スロット名への対応（例: "gpt4o"/"local"/
    # "openai"）。ランタイム選択（production_provider_name）で参照する。実行時スロットへ
    # 対応しないカード（例: S2S 専用）は None。
    provider_name: str | None = None

    def __post_init__(self) -> None:
        """不変条件: stage / status / runtime が既知集合に属すること。"""
        if self.stage not in STAGES:
            raise ValueError(f"未知の stage: {self.stage!r}（許可={sorted(STAGES)}）")
        if self.status not in STATUSES:
            raise ValueError(
                f"未知の status: {self.status!r}（許可={sorted(STATUSES)}）"
            )
        if self.runtime not in RUNTIMES:
            raise ValueError(
                f"未知の runtime: {self.runtime!r}（許可={sorted(RUNTIMES)}）"
            )


def _quality_score(card: ModelCard) -> float:
    """metrics から代表品質スコアを取り出す（無ければ 0.0）。"""
    for key in _QUALITY_METRIC_KEYS:
        if key in card.metrics:
            return float(card.metrics[key])
    return 0.0


class ModelCatalog:
    """
    ModelCard の治理カタログ（登録・照会・ライフサイクル遷移検証）。

    実行時のステージ実体は解決しない（責務は registry.py）。本クラスは
    「どのモデルが今どの状態か」というメタ情報のみを保持する。
    """

    def __init__(self) -> None:
        # 登録順を保持（production_for のタイブレークに利用）。
        self._cards: dict[str, ModelCard] = {}

    def register(self, card: ModelCard) -> None:
        """カードを登録する（同一 model_id は上書き）。"""
        if card.model_id in self._cards:
            logger.info("[ModelCatalog] 既存カードを上書き: %s", card.model_id)
        self._cards[card.model_id] = card

    def get(self, model_id: str) -> ModelCard | None:
        """model_id でカードを取得する（無ければ None）。"""
        return self._cards.get(model_id)

    def list(
        self,
        *,
        stage: str | None = None,
        status: str | None = None,
        language: str | None = None,
    ) -> list[ModelCard]:
        """条件でフィルタしたカード一覧を返す（フィルタは AND 合成・登録順）。"""
        result: list[ModelCard] = []
        for card in self._cards.values():
            if stage is not None and card.stage != stage:
                continue
            if status is not None and card.status != status:
                continue
            if language is not None and language not in card.languages:
                continue
            result.append(card)
        return result

    def set_status(self, model_id: str, new_status: str) -> ModelCard:
        """
        ライフサイクル遷移を検証して status を更新する。

        許可遷移以外（例: draft→production, deprecated→*）は ValueError。
        """
        card = self._cards.get(model_id)
        if card is None:
            raise KeyError(f"未登録の model_id: {model_id!r}")
        if new_status not in STATUSES:
            raise ValueError(
                f"未知の status: {new_status!r}（許可={sorted(STATUSES)}）"
            )
        allowed = _ALLOWED_TRANSITIONS.get(card.status, frozenset())
        if new_status not in allowed:
            raise ValueError(
                f"禁止された遷移: {card.status!r} -> {new_status!r} "
                f"（{card.status!r} から許可={sorted(allowed)}）"
            )
        card.status = new_status
        logger.info("[ModelCatalog] %s の状態遷移: -> %s", model_id, new_status)
        return card

    def production_for(self, stage: str, language: str) -> ModelCard | None:
        """
        指定ステージ×言語の production カードを 1 件返す（非該当は None）。

        選択規則: status==production かつ language を含むカードのうち、
        代表品質スコア（_quality_score）が最大のものを返す。同点なら登録順で
        先に登録されたカードを優先する（決定的な結果を保証）。
        """
        candidates = [
            card
            for card in self._cards.values()
            if card.stage == stage
            and card.status == STATUS_PRODUCTION
            and language in card.languages
        ]
        if not candidates:
            return None
        # max は安定なため、同点時は登録順で最初の候補が保持される。
        return max(candidates, key=_quality_score)

    def is_commercial_allowed(self, card: ModelCard) -> bool:
        """
        商用利用可否を判定する（研究のみのライセンスは False）。

        判定基準: license を小文字化し NC マーカー（non-commercial / cc-by-nc 等）
        を含めば False。NLLB の CC-BY-NC を商用不可へ倒す一方、Apache-2.0 / MIT /
        CC-BY 等は True（商用可）とする（§4.3）。
        """
        text = card.license.lower()
        return not any(marker in text for marker in _NON_COMMERCIAL_MARKERS)


# ============================================================
# 既定カタログの seed
# ============================================================
# seed 時刻は 1 度だけ確定させ、全既定カードで共有する。
_SEED_CREATED_AT = datetime.now(timezone.utc).isoformat()

# 既定 status 方針: cloud（検証済み商用 API）は production、local（自前検証要）は
# staging、非商用ライセンス（研究用途）の local は draft 留め。これにより主要
# ステージ（asr/t2t/tts）には必ず cloud の production カードが存在する。


def _card(
    model_id: str,
    stage: str,
    base_model: str,
    runtime: str,
    *,
    quantization: str | None,
    languages: list[str],
    license: str,
    hardware_profile: str,
    metrics: dict[str, float],
    status: str,
    provider_name: str | None = None,
) -> ModelCard:
    """seed 用の ModelCard 生成ヘルパ（created_at / approved_by を方針で補完）。"""
    return ModelCard(
        model_id=model_id,
        stage=stage,
        base_model=base_model,
        runtime=runtime,
        quantization=quantization,
        languages=list(languages),
        license=license,
        hardware_profile=hardware_profile,
        metrics=metrics,
        created_at=_SEED_CREATED_AT,
        approved_by="governance" if status == STATUS_PRODUCTION else None,
        status=status,
        provider_name=provider_name,
    )


def _build_default_catalog() -> ModelCatalog:
    """config の既存モデル名から既定カードを seed する。"""
    langs = list(settings.supported_languages)  # ["ja", "en", "zh", "vi"]
    catalog = ModelCatalog()

    catalog.register(
        _card(
            "asr-openai-transcribe",
            STAGE_ASR,
            settings.openai_transcribe_model,
            RUNTIME_CLOUD,
            quantization=None,
            languages=langs,
            license="proprietary",
            hardware_profile="cloud-api",
            metrics={"quality": 0.95, "latency_ms": 400.0},
            status=STATUS_PRODUCTION,
            provider_name="gpt4o",
        )
    )
    catalog.register(
        _card(
            "asr-faster-whisper",
            STAGE_ASR,
            settings.local_asr_model,
            RUNTIME_FASTER_WHISPER,
            quantization=settings.local_asr_compute_type,
            languages=langs,
            license="mit",  # Whisper は MIT ライセンス（商用可）
            hardware_profile="gpu-12gb",
            metrics={"quality": 0.92, "latency_ms": 600.0},
            status=STATUS_STAGING,
            provider_name="local",
        )
    )

    catalog.register(
        _card(
            "t2t-openai-translate",
            STAGE_T2T,
            settings.openai_translate_model,
            RUNTIME_CLOUD,
            quantization=None,
            languages=langs,
            license="proprietary",
            hardware_profile="cloud-api",
            metrics={"quality": 0.9, "latency_ms": 500.0},
            status=STATUS_PRODUCTION,
            provider_name="openai",
        )
    )
    catalog.register(
        _card(
            "t2t-opus-mt",
            STAGE_T2T,
            "opus-mt",
            RUNTIME_CT2,
            quantization=settings.local_mt_compute_type,
            languages=langs,
            license="cc-by-4.0",  # OPUS-MT は CC-BY（商用可）
            hardware_profile="cpu",
            metrics={"quality": 0.82, "latency_ms": 200.0},
            status=STATUS_STAGING,
            provider_name="local",
        )
    )
    catalog.register(
        _card(
            "t2t-nllb-200",
            STAGE_T2T,
            "nllb-200-distilled-600M",
            RUNTIME_CT2,
            quantization="int8",
            languages=langs,
            # NLLB は CC-BY-NC（研究のみ・商用不可）。§4.3 の方針で draft 留め。
            license="cc-by-nc-4.0",
            hardware_profile="cpu",
            metrics={"quality": 0.85, "latency_ms": 250.0},
            status=STATUS_DRAFT,
            provider_name="local",
        )
    )
    # Gemini Live S2S（雲）。t2t の代替候補として staging で登録。
    catalog.register(
        _card(
            "t2t-gemini-live",
            STAGE_T2T,
            settings.gemini_live_model,
            RUNTIME_CLOUD,
            quantization=None,
            languages=langs,
            license="proprietary",
            hardware_profile="cloud-api",
            metrics={"quality": 0.88, "latency_ms": 450.0},
            status=STATUS_STAGING,
        )
    )

    catalog.register(
        _card(
            "tts-openai",
            STAGE_TTS,
            settings.openai_tts_model,
            RUNTIME_CLOUD,
            quantization=None,
            languages=langs,
            license="proprietary",
            hardware_profile="cloud-api",
            metrics={"quality": 0.9, "latency_ms": 500.0},
            status=STATUS_PRODUCTION,
            provider_name="openai",
        )
    )
    catalog.register(
        _card(
            "tts-kokoro",
            STAGE_TTS,
            settings.local_tts_model,
            RUNTIME_ONNX,
            quantization=None,
            languages=langs,
            license="apache-2.0",  # Kokoro は Apache-2.0（商用可）
            hardware_profile="cpu",
            metrics={"quality": 0.8, "latency_ms": 300.0},
            status=STATUS_STAGING,
            provider_name="local",
        )
    )
    return catalog


# モジュール唯一の既定カタログ（新規モデルはここへ register する）。
model_catalog = _build_default_catalog()


# ============================================================
# ランタイム選択ブリッジ（治理カタログ → 実行時スロット名）
# ============================================================
# registry.py の実行時ステージ名（asr/mt/tts）→ 本カタログの stage 名への対応。
# 注: 本カタログは翻訳段を "t2t" と呼び、registry.py は "mt" と呼ぶ（歴史的差異）。
# 本ブリッジのみが両者の差異を吸収する（registry.py は本モジュールへ一方向依存）。
_REGISTRY_STAGE_TO_CATALOG: dict[str, str] = {
    "asr": STAGE_ASR,
    "mt": STAGE_T2T,
    "tts": STAGE_TTS,
}


def production_provider_name(registry_stage: str, language: str) -> str | None:
    """registry.py のステージに対する production モデルの provider_name を返す。

    入力: registry の実行時ステージ名（asr/mt/tts）と対象言語。
    出力: 対応する production ModelCard の provider_name（無ければ None）。
    注意点: カタログの stage 名（t2t）と registry の stage 名（mt）の差異を吸収する。
        production カードが無い・未対応ステージ・provider_name 未設定なら None を返し、
        呼び出し側（registry.build_composite_provider）は既定スロットへ縮退する。
    """
    catalog_stage = _REGISTRY_STAGE_TO_CATALOG.get(registry_stage)
    if catalog_stage is None:
        return None
    card = model_catalog.production_for(catalog_stage, language)
    if card is None:
        return None
    return card.provider_name


def provider_name_for_model(model_id: str) -> str | None:
    """model_id（ModelCard 識別子）→ 実行時スロット名 provider_name（無ければ None）。

    A/B 実験の variant.model_id を registry.py の実行時スロット名へ橋渡しする
    （ab_runtime.CompositeExperimentSelector が variant を実体解決する際に用いる）。
    未登録 model_id・provider_name 未設定のカードは None を返す。
    """
    card = model_catalog.get(model_id)
    return card.provider_name if card else None
