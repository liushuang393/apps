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

import logging
from collections.abc import Callable
from dataclasses import dataclass, field

from app.ai_pipeline.providers.base import AIProvider, TranslationResult
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
            return spec.factory()
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

    def __init__(self, asr: object, mt: object, tts: object | None) -> None:
        self._asr = asr
        self._mt = mt
        self._tts = tts

    async def transcribe_audio(self, audio_data: bytes, language: str) -> str:
        return await self._asr.transcribe_audio(audio_data, language)

    async def transcribe_with_detection(
        self, audio_data: bytes, hint_language: str = "multi"
    ) -> tuple[str, str]:
        return await self._asr.transcribe_with_detection(audio_data, hint_language)

    async def translate_audio(
        self, audio_data: bytes, source_language: str, target_language: str
    ) -> TranslationResult:
        if source_language == target_language:
            text = await self._asr.transcribe_audio(audio_data, source_language)
            return TranslationResult(source_language, target_language, text, text, None)
        original = await self._asr.transcribe_audio(audio_data, source_language)
        if not original:
            return TranslationResult(source_language, target_language, "", "", None)
        translated = await self._mt.translate_text(
            original, source_language, target_language
        )
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
    reg.register(ProviderSpec(name="none", stage=STAGE_TTS, factory=NullTTSStage))
    return reg


# モジュール唯一の既定レジストリ（新規プロバイダーはここへ register する）
registry = _build_default_registry()


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
    """いずれかのスロットが非 "auto" のとき Composite を有効化する"""
    return (
        settings.asr_provider != "auto"
        or settings.mt_provider != "auto"
        or settings.tts_provider != "auto"
    )


def _slot_name(stage: str, slot_value: str, defaults: dict[str, str]) -> str:
    return defaults[stage] if slot_value == "auto" else slot_value


def build_composite_provider() -> AIProvider:
    """config スロットに従い CompositeAIProvider を組み立てる"""
    defaults = default_slot_names(settings.ai_provider)
    asr = registry.resolve(
        STAGE_ASR, _slot_name(STAGE_ASR, settings.asr_provider, defaults)
    )
    mt = registry.resolve(
        STAGE_MT, _slot_name(STAGE_MT, settings.mt_provider, defaults)
    )
    tts = registry.resolve(
        STAGE_TTS, _slot_name(STAGE_TTS, settings.tts_provider, defaults)
    )
    logger.info(
        "[Registry] Composite 構成: asr=%s, mt=%s, tts=%s",
        getattr(asr, "name", None),
        getattr(mt, "name", None),
        getattr(tts, "name", None),
    )
    return CompositeAIProvider(asr, mt, tts)
