"""
A/B 実験のライブ実行時配線（改善案 §5.1 / P4-wiring ②）。

目的:
    A/B 実験（ab_testing の決定的配信）をライブのカスケード経路（CompositeAIProvider）へ
    接続する。AIPipeline はプロセス singleton で provider 構築時に会議/話者文脈を持たない
    ため、発話ごとの配信単位を ContextVar で運び、CompositeExperimentSelector が発話ごとに
    ステージ実体（ASR/MT）を variant へ差し替え、観測指標を experiment_metric へ記録する。

責務境界:
    - 配信判定は ab_testing（純ロジック）、実体解決は registry.py、指標永続は
      app.db.experiments。本モジュールはそれらを「発話ごとに束ねる実行時アダプタ」。
    - AIProvider の抽象 IF は変更しない（全 provider 波及を避ける）。unit は ContextVar 経由。

設計原則:
    - 既定無効: 実験が無い/割当なし/実体解決不能なら既定ステージへ縮退（挙動不変）。
    - 非ブロッキング記録: 指標記録は fire-and-forget（ライブ遅延を増やさない）。失敗は握る。
    - MVP 制約: unit は現状 user（speaker_id）のみライブで解決可能。room/session unit は
      文脈未設定のため割当なし→既定へ縮退（将来 orchestrator が文脈設定で有効化）。
"""

from __future__ import annotations

import asyncio
import logging
from contextvars import ContextVar, Token
from dataclasses import dataclass

from app.ai_pipeline.ab_testing import ExperimentRegistry, assign, resolve_unit_id
from app.ai_pipeline.model_registry import provider_name_for_model
from app.db.experiments import record_experiment_metric

logger = logging.getLogger(__name__)

# registry.py の実行時ステージ名（asr/mt/tts）→ ab_testing/model_registry の
# カタログ stage 名（asr/t2t/tts）。実験は catalog stage で定義される。
_STAGE_TO_CATALOG: dict[str, str] = {"asr": "asr", "mt": "t2t", "tts": "tts"}


@dataclass(frozen=True)
class ABContext:
    """発話ごとの A/B 配信単位の文脈（存在するものだけ設定する）。"""

    user_id: str | None = None
    room_id: str | None = None
    session_id: str | None = None


# 発話処理タスクごとの A/B 文脈（asyncio タスクはコンテキストを複製するためタスク安全）。
_AB_CTX: ContextVar[ABContext | None] = ContextVar("ab_ctx", default=None)


def set_ab_context(ctx: ABContext) -> Token:
    """A/B 文脈を設定し reset 用トークンを返す（process_audio が発話ごとに呼ぶ）。"""
    return _AB_CTX.set(ctx)


def get_ab_context() -> ABContext | None:
    """現在の A/B 文脈を返す（未設定なら None）。"""
    return _AB_CTX.get()


def reset_ab_context(token: Token) -> None:
    """A/B 文脈を元へ戻す（set_ab_context のトークンで）。"""
    _AB_CTX.reset(token)


class CompositeExperimentSelector:
    """発話ごとにステージ実体を variant へ差し替え、指標を記録する実行時セレクタ。

    registry（実体解決）・experiments（実験定義）・record_fn（指標記録）を注入する。
    select() は純粋な解決（DB 非依存）、note() は fire-and-forget の指標記録。
    """

    def __init__(
        self,
        *,
        registry: object,
        experiments: ExperimentRegistry,
        record_fn=record_experiment_metric,
    ) -> None:
        self._registry = registry
        self._experiments = experiments
        self._record = record_fn
        # fire-and-forget タスクの GC 抑止用の保持集合。
        self._pending: set[asyncio.Task] = set()
        # 解決済みステージ実体のキャッシュ（(registry_stage, provider_name)→実体）。
        self._cache: dict[tuple[str, str], object] = {}

    def select(
        self, registry_stage: str, default_instance: object
    ) -> tuple[object, str | None, str | None]:
        """ステージ実体を選ぶ。返り値 (実体, experiment_key|None, variant名|None)。

        実験が無い/割当なし/実体解決不能なら (default_instance, None, None)（既定縮退）。
        注意点: 1 ステージに複数実験があっても先頭 1 件のみ適用する（MVP）。
            本メソッドは**絶対に例外を送出しない**（ライブ翻訳経路から呼ばれるため、
            for_stage/resolve_unit_id/assign 等の想定外異常も握って既定へ縮退する。review 指摘）。
        """
        try:
            catalog_stage = _STAGE_TO_CATALOG.get(registry_stage)
            if catalog_stage is None:
                return default_instance, None, None
            exps = self._experiments.for_stage(catalog_stage)
            if not exps:
                return default_instance, None, None
            exp = exps[0]
            ctx = get_ab_context()
            unit_id = resolve_unit_id(
                exp,
                room_id=ctx.room_id if ctx else None,
                user_id=ctx.user_id if ctx else None,
                session_id=ctx.session_id if ctx else None,
            )
            variant = assign(exp, unit_id)
            if variant is None:
                return default_instance, None, None
            provider_name = provider_name_for_model(variant.model_id)
            if not provider_name:
                logger.warning(
                    "[AB] variant %s の model_id=%s に provider_name 無し（既定へ縮退）",
                    variant.name,
                    variant.model_id,
                )
                return default_instance, None, None
            instance = self._resolve_cached(registry_stage, provider_name)
            if instance is None:
                return default_instance, None, None
            return instance, exp.key, variant.name
        except Exception as e:  # noqa: BLE001 - 配信判定の想定外異常もライブを壊さない
            logger.warning("[AB] variant 選択に失敗（既定へ縮退）: %s", e)
            return default_instance, None, None

    def _resolve_cached(self, registry_stage: str, provider_name: str) -> object | None:
        """(stage, provider_name) の実体をキャッシュ付きで解決する（不能なら None）。"""
        key = (registry_stage, provider_name)
        if key in self._cache:
            return self._cache[key]
        try:
            instance = self._registry.resolve(registry_stage, provider_name)
        except Exception as e:  # noqa: BLE001 - 解決不能は既定へ縮退
            logger.warning(
                "[AB] %s/%s の実体解決に失敗（既定へ縮退）: %s",
                registry_stage,
                provider_name,
                e,
            )
            return None
        if instance is not None:
            self._cache[key] = instance
        return instance

    def note(
        self,
        *,
        experiment_key: str,
        variant: str,
        stage: str,
        metric_name: str,
        metric_value: float,
    ) -> None:
        """指標を fire-and-forget で記録する（ライブ遅延を増やさない）。

        実行中の event loop が無い場合は何もしない（同期文脈での誤用を無害化）。
        """
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        ctx = get_ab_context()
        unit_id = ctx.user_id if ctx else None
        task = loop.create_task(
            self._safe_record(
                experiment_key=experiment_key,
                variant=variant,
                stage=stage,
                metric_name=metric_name,
                metric_value=metric_value,
                unit_id=unit_id,
            )
        )
        self._pending.add(task)
        task.add_done_callback(self._pending.discard)

    async def _safe_record(
        self,
        *,
        experiment_key: str,
        variant: str,
        stage: str,
        metric_name: str,
        metric_value: float,
        unit_id: str | None,
    ) -> None:
        """record_fn を失敗握りで呼ぶ（記録失敗はライブを壊さない）。"""
        try:
            await self._record(
                experiment_key=experiment_key,
                variant=variant,
                metric_name=metric_name,
                metric_value=metric_value,
                unit_id=unit_id,
                stage=stage,
            )
        except Exception as e:  # noqa: BLE001 - 指標記録失敗はライブを壊さない
            logger.warning("[AB] 指標記録に失敗: %s", e)
