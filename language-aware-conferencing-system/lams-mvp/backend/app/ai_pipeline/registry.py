"""
Provider 集中管理（Registry + ステージ分離 + Composite）

目的:
    改善.md の 2 主線設計を保ちつつ、ASR / MT / TTS を独立スロット化し「唯一の
    カタログ」で管理する。env 1 行で各ステージを差し替えられるようにし、新規
    プロバイダー追加はカタログへ 1 エントリ登録するだけで済むようにする。
入力 / 出力:
    config.py のスロット（asr_provider / mt_provider / tts_provider）を読み取り、
    AIProvider 互換の CompositeAIProvider を組み立てて返す。
注意点:
    - 3 スロットすべて "auto" のときは Composite を使わず従来の一体型 provider を
      用いる（完全な後方互換）。判定は composite_enabled() が担う。
    - 鍵未設定スロットは available() が False を返し、fallback へ自動委譲する
      （既存 google→gpt4o の方針を一般化）。fallback が無ければ None を返す。
    - Mode A（OpenAI S2S）とはコードパスを共有しない（絶対原則）。
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.ai_pipeline.ab_runtime import CompositeExperimentSelector

from app.ai_pipeline.providers.base import AIProvider, APIKeyError, TranslationResult
from app.config import settings

logger = logging.getLogger(__name__)

STAGE_ASR = "asr"
STAGE_MT = "mt"
STAGE_TTS = "tts"


def _always_available() -> bool:
    """既定の可用性判定（常に利用可能）"""
    return True


@dataclass
class ProviderSpec:
    """
    カタログの 1 エントリ。

    name: スロット名（env で指定する識別子）
    stage: STAGE_ASR / STAGE_MT / STAGE_TTS のいずれか
    factory: ステージ実体を生成する呼び出し可能オブジェクト
    required_env: 必要な環境変数キー（ドキュメント / 診断用）
    available: 利用可能判定（鍵やライブラリの有無）
    fallback: 利用不可時に委譲する同ステージ別スロット名
    """

    name: str
    stage: str
    factory: Callable[[], object]
    required_env: list[str] = field(default_factory=list)
    available: Callable[[], bool] = _always_available
    fallback: str | None = None


class ProviderRegistry:
    """ステージ + 名前で実体を解決する集中カタログ"""

    def __init__(self) -> None:
        self._specs: dict[tuple[str, str], ProviderSpec] = {}

    def register(self, spec: ProviderSpec) -> None:
        self._specs[(spec.stage, spec.name)] = spec

    def names(self, stage: str) -> list[str]:
        return [name for (s, name) in self._specs if s == stage]

    def resolve(
        self, stage: str, name: str, _seen: set[tuple[str, str]] | None = None
    ) -> object | None:
        """可用性を確認しつつ実体を解決する（不可なら fallback / None）"""
        seen = _seen if _seen is not None else set()
        spec = self._specs.get((stage, name))
        if spec is None:
            raise KeyError(f"未登録のプロバイダー: stage={stage}, name={name}")
        if (stage, name) in seen:
            logger.warning("[Registry] フォールバック循環を検知: %s/%s", stage, name)
            return None
        seen.add((stage, name))
        if spec.available():
            try:
                return spec.factory()
            except Exception as e:  # noqa: BLE001 - 生成失敗は fallback で救済しライブ継続
                # 契約違反（PluginError）・鍵不正・ライブラリ不整合などの実体生成失敗を
                # 「実質利用不可」とみなし、例外を伝播させず fallback 連鎖へ委譲する。
                # 破損プラグイン 1 個が会議解決全体を巻き添えにするのを防ぐ（フェイルソフト）。
                logger.warning(
                    "[Registry] %s/%s の実体生成に失敗（fallbackへ委譲）: %s",
                    stage,
                    name,
                    e,
                )
        if spec.fallback:
            logger.warning(
                "[Registry] %s/%s は利用不可、fallback=%s へ委譲",
                stage,
                name,
                spec.fallback,
            )
            return self.resolve(stage, spec.fallback, seen)
        logger.warning("[Registry] %s/%s は利用不可かつ fallback なし", stage, name)
        return None


class CompositeAIProvider(AIProvider):
    """
    独立した ASR / MT / TTS ステージを AIProvider 互換に束ねる合成プロバイダー。

    Mode B（ASR→MT＋字幕）相当の処理経路を、ステージ単位で差し替え可能にする。
    """

    def __init__(
        self,
        asr: object,
        mt: object,
        tts: object | None,
        *,
        selector: CompositeExperimentSelector | None = None,
    ) -> None:
        self._asr = asr
        self._mt = mt
        self._tts = tts
        # A/B 実験セレクタ（None＝実験なし＝従来どおり固定ステージで処理）。
        self._selector = selector

    def _pick(self, stage: str, default: object) -> tuple[object, str | None, str | None]:
        """発話ごとのステージ実体を選ぶ（selector 無しなら固定実体）。

        返り値 (実体, experiment_key|None, variant名|None)。experiment_key が None なら
        実験非適用（既定実体）を意味する。
        """
        if self._selector is None:
            return default, None, None
        return self._selector.select(stage, default)

    def _note(
        self,
        experiment_key: str | None,
        variant: str | None,
        stage: str,
        metric_name: str,
        metric_value: float,
    ) -> None:
        """A/B 指標を記録する（実験非適用・selector 無しなら何もしない）。"""
        if self._selector is None or experiment_key is None or variant is None:
            return
        self._selector.note(
            experiment_key=experiment_key,
            variant=variant,
            stage=stage,
            metric_name=metric_name,
            metric_value=metric_value,
        )

    async def transcribe_audio(self, audio_data: bytes, language: str) -> str:
        asr, ek, vn = self._pick(STAGE_ASR, self._asr)
        t0 = time.monotonic()
        text = await asr.transcribe_audio(audio_data, language)
        self._note(ek, vn, STAGE_ASR, "latency_ms", (time.monotonic() - t0) * 1000.0)
        return text

    async def transcribe_with_detection(
        self, audio_data: bytes, hint_language: str = "multi"
    ) -> tuple[str, str]:
        asr, ek, vn = self._pick(STAGE_ASR, self._asr)
        t0 = time.monotonic()
        result = await asr.transcribe_with_detection(audio_data, hint_language)
        self._note(ek, vn, STAGE_ASR, "latency_ms", (time.monotonic() - t0) * 1000.0)
        return result

    async def translate_audio(
        self,
        audio_data: bytes,
        source_language: str,
        target_language: str,
        original_text: str | None = None,
    ) -> TranslationResult:
        asr, _asr_ek, _asr_vn = self._pick(STAGE_ASR, self._asr)
        if source_language == target_language:
            text = original_text or await asr.transcribe_audio(
                audio_data, source_language
            )
            return TranslationResult(source_language, target_language, text, text, None)
        original = original_text or await asr.transcribe_audio(
            audio_data, source_language
        )
        if not original:
            return TranslationResult(source_language, target_language, "", "", None)
        mt, mt_ek, mt_vn = self._pick(STAGE_MT, self._mt)
        t0 = time.monotonic()
        translated = await mt.translate_text(original, source_language, target_language)
        self._note(mt_ek, mt_vn, STAGE_MT, "latency_ms", (time.monotonic() - t0) * 1000.0)
        # 品質代理指標: 数字保持率（原文に数字がある場合のみ・改善.md §15）。
        if translated and mt_ek:
            from app.ai_pipeline.qos import number_retention

            rate = number_retention(original, translated)
            if rate is not None:
                self._note(mt_ek, mt_vn, STAGE_MT, "number_retention", rate)
        audio_out: bytes | None = None
        # 空訳（失敗）はセンチネル化せず TTS もスキップする（欠陥 #8）。
        if translated and self._tts is not None:
            try:
                audio_out = await self._tts.synthesize(translated, target_language)
            except Exception as e:  # noqa: BLE001 - TTS 失敗は字幕継続のため握り潰す
                logger.warning("[Composite] TTS 失敗: %s", e)
        return TranslationResult(
            source_language, target_language, original, translated or "", audio_out
        )


# ============================================================
# 既定カタログ（既存プロバイダーをステージ実体として登録）
# ============================================================
def _openai_available() -> bool:
    return bool(settings.openai_api_key)


def _deepgram_available() -> bool:
    return bool(settings.deepgram_api_key)


def _google_available() -> bool:
    from app.ai_pipeline.providers.google import google_runtime_available

    return google_runtime_available()


def _make_gpt4o_asr() -> object:
    from app.ai_pipeline.providers.gpt4o_transcribe import GPT4oTranscribeProvider
    from app.ai_pipeline.providers.stages import AIProviderASRStage

    return AIProviderASRStage(GPT4oTranscribeProvider(), "gpt4o")


def _make_deepgram_asr() -> object:
    from app.ai_pipeline.providers.deepgram import DeepgramProvider
    from app.ai_pipeline.providers.stages import AIProviderASRStage

    return AIProviderASRStage(DeepgramProvider(), "deepgram")


def _make_google_asr() -> object:
    from app.ai_pipeline.providers.google import GoogleProvider
    from app.ai_pipeline.providers.stages import AIProviderASRStage

    return AIProviderASRStage(GoogleProvider(), "google")


# --- Lite 本地栈（faster-whisper / OPUS-MT / Kokoro）。ランタイム未導入時は
#     available() が False を返し、雲プロバイダーへ自動フォールバックする（§P1）。
def _local_asr_available() -> bool:
    from app.ai_pipeline.providers import local_asr

    return local_asr.available()


def _make_local_asr() -> object:
    from app.ai_pipeline.providers.local_asr import FasterWhisperASRStage

    return FasterWhisperASRStage()


def _local_mt_available() -> bool:
    from app.ai_pipeline.providers import local_mt

    return local_mt.available()


def _make_local_mt() -> object:
    from app.ai_pipeline.providers.local_mt import LocalMTStage

    return LocalMTStage()


def _local_tts_available() -> bool:
    from app.ai_pipeline.providers import local_tts

    return local_tts.available()


def _make_local_tts() -> object:
    from app.ai_pipeline.providers.local_tts import LocalTTSStage

    return LocalTTSStage()


def _build_default_registry() -> ProviderRegistry:
    """既存プロバイダー（gpt4o / deepgram / google / openai TTS）を登録する"""
    from app.ai_pipeline.providers.stages import (
        GoogleMTStage,
        NullTTSStage,
        OpenAIMTStage,
        OpenAITTSStage,
    )

    reg = ProviderRegistry()
    # --- ASR ---
    reg.register(
        ProviderSpec(
            name="gpt4o",
            stage=STAGE_ASR,
            factory=_make_gpt4o_asr,
            required_env=["OPENAI_API_KEY"],
            available=_openai_available,
        )
    )
    reg.register(
        ProviderSpec(
            name="deepgram",
            stage=STAGE_ASR,
            factory=_make_deepgram_asr,
            required_env=["DEEPGRAM_API_KEY"],
            available=_deepgram_available,
            fallback="gpt4o",
        )
    )
    reg.register(
        ProviderSpec(
            name="google",
            stage=STAGE_ASR,
            factory=_make_google_asr,
            required_env=["GOOGLE_PROJECT_ID"],
            available=_google_available,
            fallback="gpt4o",
        )
    )
    reg.register(
        ProviderSpec(
            name="local",
            stage=STAGE_ASR,
            factory=_make_local_asr,
            required_env=[],
            available=_local_asr_available,
            fallback="gpt4o",
        )
    )
    # --- MT ---
    reg.register(
        ProviderSpec(
            name="openai",
            stage=STAGE_MT,
            factory=OpenAIMTStage,
            required_env=["OPENAI_API_KEY"],
            available=_openai_available,
        )
    )
    reg.register(
        ProviderSpec(
            name="google",
            stage=STAGE_MT,
            factory=GoogleMTStage,
            required_env=["GOOGLE_PROJECT_ID"],
            available=_google_available,
            fallback="openai",
        )
    )
    reg.register(
        ProviderSpec(
            name="local",
            stage=STAGE_MT,
            factory=_make_local_mt,
            required_env=["LOCAL_MT_MODEL_DIR"],
            available=_local_mt_available,
            fallback="openai",
        )
    )
    # --- TTS ---
    reg.register(
        ProviderSpec(
            name="openai",
            stage=STAGE_TTS,
            factory=OpenAITTSStage,
            required_env=["OPENAI_API_KEY"],
            available=_openai_available,
            fallback="none",
        )
    )
    reg.register(
        ProviderSpec(
            name="local",
            stage=STAGE_TTS,
            factory=_make_local_tts,
            required_env=[],
            available=_local_tts_available,
            fallback="openai",
        )
    )
    reg.register(ProviderSpec(name="none", stage=STAGE_TTS, factory=NullTTSStage))
    return reg


# モジュール唯一の既定レジストリ（新規プロバイダーはここへ register する）
registry = _build_default_registry()

# 外部プロバイダー・プラグインを読み込む（設定で明示有効化時のみ / fail-safe）。
# コア登録の後に実行することで、プラグインは既定プロバイダーへ fallback できる。
# plugin_sdk は本モジュールの ProviderSpec 等に依存するため、循環回避のため遅延 import。
try:
    from app.ai_pipeline.plugin_sdk import load_configured_plugins

    load_configured_plugins(registry)
except Exception as e:  # noqa: BLE001 - プラグイン基盤の想定外異常でコアを止めない
    logger.warning("[Registry] プラグイン読み込みで想定外エラー: %s", e)


# ============================================================
# スロット解決（auto → プリセット既定名の導出）
# ============================================================
def default_slot_names(preset: str) -> dict[str, str]:
    """ai_provider プリセットから各スロットの既定名を導出する（純粋関数）"""
    asr_map = {
        "gpt4o_transcribe": "gpt4o",
        "gpt_realtime": "gpt4o",
        "deepgram": "deepgram",
        "google": "google",
    }
    return {
        STAGE_ASR: asr_map.get(preset, "gpt4o"),
        STAGE_MT: "google" if preset == "google" else "openai",
        STAGE_TTS: "none" if preset == "google" else "openai",
    }


def composite_enabled() -> bool:
    """Composite を有効化する条件。

    いずれかのスロットが非 "auto"、または治理カタログのランタイム選択が有効なとき。
    後者は全スロット "auto" のままでもカタログ主導の選択を効かせるための条件。
    """
    return (
        settings.asr_provider != "auto"
        or settings.mt_provider != "auto"
        or settings.tts_provider != "auto"
        or settings.use_model_registry_selection
        or settings.enable_ab_testing
    )


def _catalog_slot_name(stage: str, language: str) -> str | None:
    """model_registry の production カードから registry スロット名を導く（無効時 None）。

    use_model_registry_selection が有効なときのみカタログを参照する。カタログが返した
    名が未登録なら使わない（resolve の KeyError を回避し既定へ縮退させる）。
    """
    if not settings.use_model_registry_selection:
        return None
    try:
        from app.ai_pipeline.model_registry import production_provider_name

        name = production_provider_name(stage, language)
    except Exception as e:  # noqa: BLE001 - カタログ参照失敗は既定選択へ縮退
        logger.warning("[Registry] model_registry 参照に失敗: %s", e)
        return None
    if name and name in registry.names(stage):
        return name
    if name:
        logger.warning(
            "[Registry] カタログ選択 %s/%s は未登録のため既定へ縮退", stage, name
        )
    return None


def _slot_name(
    stage: str, slot_value: str, defaults: dict[str, str], language: str
) -> str:
    """スロット名を決める（明示指定 > カタログ選択 > プリセット既定）。"""
    if slot_value != "auto":
        return slot_value  # 明示指定を最優先（運用者の意図を尊重）
    return _catalog_slot_name(stage, language) or defaults[stage]


def build_composite_provider() -> AIProvider:
    """config スロットに従い CompositeAIProvider を組み立てる"""
    defaults = default_slot_names(settings.ai_provider)
    # カタログ選択は言語別。Composite はプロセス唯一のため代表言語で解決する。
    # supported_languages 空（病的設定）時は "ja" へ縮退するが、その場合カタログの
    # 各カードも languages=[] で seed されるため production_for は該当なし→None を返し、
    # _slot_name はプリセット既定へ安全に縮退する（クラッシュせず挙動不変。review 指摘）。
    lang = settings.supported_languages[0] if settings.supported_languages else "ja"
    asr = registry.resolve(
        STAGE_ASR, _slot_name(STAGE_ASR, settings.asr_provider, defaults, lang)
    )
    mt = registry.resolve(
        STAGE_MT, _slot_name(STAGE_MT, settings.mt_provider, defaults, lang)
    )
    tts = registry.resolve(
        STAGE_TTS, _slot_name(STAGE_TTS, settings.tts_provider, defaults, lang)
    )
    # None ステージの実行時 AttributeError を防ぐ（欠陥 #12: フェイルファスト）
    if asr is None or mt is None:
        raise APIKeyError(
            "Composite 構成を解決できません"
            f"（asr解決={asr is not None}, mt解決={mt is not None}）。"
            "OPENAI_API_KEY 等、各スロットの必要な環境変数を設定してください。"
        )
    if tts is None:
        from app.ai_pipeline.providers.stages import NullTTSStage

        logger.warning("[Registry] TTS スロット解決不能のため無音運用へ縮退")
        tts = NullTTSStage()
    logger.info(
        "[Registry] Composite 構成: asr=%s, mt=%s, tts=%s",
        getattr(asr, "name", None),
        getattr(mt, "name", None),
        getattr(tts, "name", None),
    )
    return CompositeAIProvider(asr, mt, tts, selector=_build_ab_selector())


def _build_ab_selector() -> CompositeExperimentSelector | None:
    """A/B 実験セレクタを構築する（無効・実験なしなら None＝挙動不変）。

    enable_ab_testing が有効で、かつ設定に実験が 1 件以上あるときのみ構築する。
    構築失敗（設定不正等）は None へ縮退し、Composite を通常運用へ落とす（ライブ保護）。
    """
    if not settings.enable_ab_testing:
        return None
    try:
        from app.ai_pipeline.ab_runtime import CompositeExperimentSelector
        from app.ai_pipeline.ab_testing import build_experiment_registry

        experiments = build_experiment_registry()
        if not experiments.list():
            return None
        return CompositeExperimentSelector(registry=registry, experiments=experiments)
    except Exception as e:  # noqa: BLE001 - 実験基盤の異常でライブを止めない
        logger.warning("[Registry] A/B セレクタ構築に失敗（実験なしで継続）: %s", e)
        return None
