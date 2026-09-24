"""
AI パイプライン実行時設定（env 既定 + SystemConfig 上書き）。

目的:
    - `.env` の AI_PROVIDER / ASR|MT|TTS / 会議 default_mode をブートストラップ既定とする。
    - 管理者画面からの上書きを SystemConfig(key=ai_pipeline) に永続化し、再起動なしで切替可能にする。
    - 方式2（品質カスケード）向けに partial 字幕・LLM 補正の非秘密フラグも扱う。
    - 秘密情報（API キー等）は扱わない。

注意点:
    - プロセス内キャッシュ + revision で DB を毎発話叩かない。
    - Agent 経路は DB セッション無しでも get_cached_pipeline_settings() を使える。
    - 起動時に load_pipeline_settings_from_db() を呼ぶこと。
"""

from __future__ import annotations

import json
import logging
import threading
from dataclasses import asdict, dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db.models import SystemConfig, utc_now

logger = logging.getLogger(__name__)

CONFIG_KEY = "ai_pipeline"

# mock は E2E Aレーン専用（外部 API 不要の決定論プロバイダー）
AI_PROVIDER_OPTIONS: tuple[str, ...] = (
    "gpt4o_transcribe",
    "gpt_realtime",
    "deepgram",
    "google",
    "gemini_live",
    "mock",
)
ASR_PROVIDER_OPTIONS: tuple[str, ...] = (
    "auto",
    "gpt4o",
    "deepgram",
    "google",
    "local",
)
MT_PROVIDER_OPTIONS: tuple[str, ...] = ("auto", "openai", "google", "local")
TTS_PROVIDER_OPTIONS: tuple[str, ...] = ("auto", "openai", "none", "local")
DEFAULT_MODE_OPTIONS: tuple[str, ...] = ("a", "b", "hybrid")

_FIELD_OPTIONS: dict[str, tuple[str, ...]] = {
    "ai_provider": AI_PROVIDER_OPTIONS,
    "asr_provider": ASR_PROVIDER_OPTIONS,
    "mt_provider": MT_PROVIDER_OPTIONS,
    "tts_provider": TTS_PROVIDER_OPTIONS,
    "default_mode": DEFAULT_MODE_OPTIONS,
}

# 方式2品質パック用の真偽フィールド（enum ではない）。
_BOOL_FIELDS: tuple[str, ...] = (
    "enable_partial_subtitles",
    "llm_correction_enabled",
)


@dataclass(frozen=True)
class PipelineSettingsValues:
    """パイプライン切替に使う非秘密フィールド一式。"""

    ai_provider: str
    asr_provider: str
    mt_provider: str
    tts_provider: str
    default_mode: str
    enable_partial_subtitles: bool = False
    llm_correction_enabled: bool = False

    def to_dict(self) -> dict[str, Any]:
        """JSON シリアライズ用の dict を返す。"""
        return asdict(self)


_lock = threading.RLock()
_revision: int = 0
_cached: PipelineSettingsValues | None = None


def env_pipeline_defaults() -> PipelineSettingsValues:
    """`.env` / Settings 由来のブートストラップ既定値を返す。"""
    return PipelineSettingsValues(
        ai_provider=settings.ai_provider,
        asr_provider=settings.asr_provider,
        mt_provider=settings.mt_provider,
        tts_provider=settings.tts_provider,
        default_mode="a",
        enable_partial_subtitles=settings.enable_partial_subtitles,
        llm_correction_enabled=settings.llm_correction_provider != "off",
    )


def validate_pipeline_payload(data: dict[str, Any]) -> PipelineSettingsValues:
    """
    管理者 PUT ボディを検証し、不足キーは env 既定で埋めた値を返す。

    Raises:
        ValueError: 未知フィールドまたは不正 enum / 真偽値。
    """
    allowed = set(_FIELD_OPTIONS) | set(_BOOL_FIELDS)
    unknown = set(data) - allowed
    if unknown:
        raise ValueError(f"未知のフィールドです: {sorted(unknown)}")

    base = env_pipeline_defaults().to_dict()
    for key, options in _FIELD_OPTIONS.items():
        if key not in data:
            continue
        value = data[key]
        if not isinstance(value, str) or value not in options:
            raise ValueError(
                f"{key} は {list(options)} のいずれかである必要があります: {value!r}"
            )
        base[key] = value
    for key in _BOOL_FIELDS:
        if key not in data:
            continue
        value = data[key]
        if not isinstance(value, bool):
            raise ValueError(f"{key} は bool である必要があります: {value!r}")
        base[key] = value
    return PipelineSettingsValues(**base)


def merge_overlay(overlay: dict[str, Any] | None) -> PipelineSettingsValues:
    """
    DB 上書き JSON と env 既定をマージする（不正値はキー単位で無視して env へ縮退）。
    """
    base = env_pipeline_defaults().to_dict()
    if not overlay:
        return PipelineSettingsValues(**base)
    for key, options in _FIELD_OPTIONS.items():
        raw = overlay.get(key)
        if isinstance(raw, str) and raw in options:
            base[key] = raw
        elif raw is not None:
            logger.warning(
                "[PipelineSettings] 不正値を無視して env 既定へ縮退: %s=%r", key, raw
            )
    for key in _BOOL_FIELDS:
        raw = overlay.get(key)
        if isinstance(raw, bool):
            base[key] = raw
        elif raw is not None:
            logger.warning(
                "[PipelineSettings] 不正真偽値を無視して env 既定へ縮退: %s=%r",
                key,
                raw,
            )
    return PipelineSettingsValues(**base)


def get_revision() -> int:
    """現在の設定 revision（キャッシュ無効化用）。"""
    with _lock:
        return _revision


def get_cached_pipeline_settings() -> PipelineSettingsValues:
    """
    メモリ上の有効設定を返す。

    未ロード時は env 既定を返す（起動直後やテストで DB 未読込でも安全）。
    """
    with _lock:
        if _cached is not None:
            return _cached
        return env_pipeline_defaults()


def set_cached_pipeline_settings(values: PipelineSettingsValues) -> int:
    """メモリキャッシュを更新し revision を bump して返す。"""
    global _revision, _cached
    with _lock:
        _cached = values
        _revision += 1
        rev = _revision
    logger.info(
        "[PipelineSettings] 有効設定を更新 revision=%s ai_provider=%s "
        "asr=%s mt=%s tts=%s default_mode=%s partial=%s correction=%s",
        rev,
        values.ai_provider,
        values.asr_provider,
        values.mt_provider,
        values.tts_provider,
        values.default_mode,
        values.enable_partial_subtitles,
        values.llm_correction_enabled,
    )
    return rev


def reset_pipeline_settings_cache_for_tests() -> None:
    """テスト用: キャッシュと revision を初期状態へ戻す。"""
    global _revision, _cached
    with _lock:
        _cached = None
        _revision = 0


def collect_availability_warnings(values: PipelineSettingsValues) -> list[str]:
    """資格・ランタイム不足の警告メッセージ（PUT は拒否せず表示用）。"""
    warnings: list[str] = []
    local_hybrid = values.default_mode == "hybrid" and all(
        provider == "local"
        for provider in (values.asr_provider, values.mt_provider, values.tts_provider)
    )
    if (
        not local_hybrid
        and values.ai_provider in ("gpt4o_transcribe", "gpt_realtime")
        and not settings.openai_api_key
    ):
        warnings.append("OPENAI_API_KEY が未設定です。")
    if (
        not local_hybrid
        and values.ai_provider == "deepgram"
        and not settings.deepgram_api_key
    ):
        warnings.append("DEEPGRAM_API_KEY が未設定です。")
    if not local_hybrid and values.ai_provider == "gemini_live":
        try:
            from app.ai_pipeline.providers.gemini_live import (
                gemini_live_runtime_available,
            )

            if not gemini_live_runtime_available():
                warnings.append(
                    "gemini_live は GEMINI_API_KEY/ライブラリ未整備のため "
                    "gpt4o_transcribe へフォールバックします。"
                )
        except Exception:  # noqa: BLE001
            warnings.append("gemini_live の可用性判定に失敗しました。")
    if (
        not local_hybrid and values.ai_provider == "google"
    ) or values.asr_provider == "google":
        try:
            from app.ai_pipeline.providers.google import google_runtime_available

            if not google_runtime_available():
                warnings.append(
                    "google は Cloud 認証/ライブラリ未整備のため "
                    "gpt4o_transcribe へフォールバックする可能性があります。"
                )
        except Exception:  # noqa: BLE001
            warnings.append("google の可用性判定に失敗しました。")
    if values.llm_correction_enabled and not settings.gemini_api_key:
        warnings.append(
            "方式2の LLM 補正が有効ですが GEMINI_API_KEY 未設定のため補正はスキップされます。"
        )
    if values.mt_provider == "local":
        warnings.append(
            "local MT は用語集（Sonowa glossary）非対応です。"
            " 方式2の品質経路では mt_provider=openai（または auto）を推奨します。"
        )
    if (
        values.asr_provider == "local"
        or values.mt_provider == "local"
        or values.tts_provider == "local"
    ):
        warnings.append(
            "local スロットは上級実装オプションです（方式そのものではありません）。"
            " ランタイム/モデル未導入時もクラウドへ切り替えません。"
            " ASR/MT は利用不可、TTS は字幕のみへ縮退します。"
        )
    if values.tts_provider == "local":
        try:
            from app.ai_pipeline.providers import local_tts

            if not local_tts.available():
                warnings.append(
                    "local TTS は差し替え口のみでモデル未結線です。"
                    "翻訳音声は出力せず字幕のみとなります（tts=none を推奨）。"
                )
        except Exception:  # noqa: BLE001
            warnings.append("local TTS の可用性判定に失敗しました。")
    if values.asr_provider == "local" or values.mt_provider == "local":
        try:
            from app.ai_pipeline.providers import local_multimodal

            if not local_multimodal.available():
                warnings.append(
                    "Gemma 4 E2B の依存未導入のため local ASR/MT は無効です。"
                    " pip install '.[local]' とモデル準備を実行してください。"
                )
        except Exception:  # noqa: BLE001
            warnings.append("local ASR/MT の可用性判定に失敗しました。")
    return warnings


async def load_pipeline_settings_from_db(db: AsyncSession) -> PipelineSettingsValues:
    """DB から読み込みキャッシュへ反映する（起動時・GET 用）。"""
    result = await db.execute(
        select(SystemConfig).where(SystemConfig.key == CONFIG_KEY)
    )
    row = result.scalar_one_or_none()
    overlay: dict[str, Any] | None = None
    if row is not None:
        try:
            parsed = json.loads(row.value)
            if isinstance(parsed, dict):
                overlay = parsed
        except json.JSONDecodeError:
            logger.warning("[PipelineSettings] SystemConfig JSON が不正です")
    values = merge_overlay(overlay)
    set_cached_pipeline_settings(values)
    return values


async def save_pipeline_settings(
    db: AsyncSession,
    values: PipelineSettingsValues,
    *,
    updated_by: str | None,
) -> int:
    """
    SystemConfig へ永続化しキャッシュを更新する。

    Returns:
        新しい revision。
    """
    payload = json.dumps(values.to_dict(), ensure_ascii=False)
    result = await db.execute(
        select(SystemConfig).where(SystemConfig.key == CONFIG_KEY)
    )
    row = result.scalar_one_or_none()
    if row:
        row.value = payload
        row.updated_at = utc_now()
        row.updated_by = updated_by
    else:
        db.add(
            SystemConfig(
                key=CONFIG_KEY,
                value=payload,
                updated_by=updated_by,
            )
        )
    await db.commit()
    return set_cached_pipeline_settings(values)


async def apply_pipeline_settings_change(
    db: AsyncSession,
    values: PipelineSettingsValues,
    *,
    updated_by: str | None,
) -> int:
    """
    保存・キャッシュ更新・プロバイダ/S2S runtime 解放を一連で行う。

    Returns:
        新しい revision。
    """
    revision = await save_pipeline_settings(db, values, updated_by=updated_by)
    from app.ai_pipeline.providers import invalidate_ai_provider_cache
    from app.ai_pipeline.runtime.factory import runtime_registry

    invalidate_ai_provider_cache()
    try:
        from app.ai_pipeline.providers.correction import reset_correction_provider

        reset_correction_provider()
    except Exception as e:  # noqa: BLE001
        logger.warning("[PipelineSettings] reset_correction_provider 失敗: %s", e)
    try:
        await runtime_registry.close_all()
    except Exception as e:  # noqa: BLE001 - 切替自体は成功扱いにする
        logger.warning("[PipelineSettings] runtime_registry.close_all 失敗: %s", e)
    return revision
