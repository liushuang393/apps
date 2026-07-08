"""
プロバイダー・プラグイン SDK（改善案 §5.1 / P4-D）。

目的:
    外部（サードパーティ）の ASR / MT / TTS 実装を、registry.py（ProviderRegistry）へ
    コア改変なしで登録できる公開 SDK を提供する。プラグイン著者はステージ契約
    （Protocol）を満たす実体と生成ファクトリを用意し、register_plugin で登録するだけ
    でよい。設定で明示有効化されたプラグインのみを fail-safe に読み込む。

責務境界（重要）:
    本モジュールは「外部実体を registry へ安全に取り込む境界」のみを担う。実行時の
    ステージ解決は registry.py、カタログ治理は model_registry.py、A/B 配信は
    ab_testing.py。プラグインの契約検証（必須メソッド）と衝突防止をここで強制する。

設計原則:
    - 契約優先: 各ステージが満たすべきメソッドを STAGE_REQUIRED_METHODS で定義し、
      解決時に実体を検証する（不適合は PluginError で拒否＝黙って壊れた実体を通さない）。
    - 衝突防止: 既存（コア）プロバイダー名の上書きは allow_override=True でのみ許可。
    - fail-safe: 設定プラグインの import 失敗・不正定義は当該のみログしてスキップし、
      コア（既定プロバイダー）を壊さない。
"""

import importlib
import logging
from collections.abc import Callable
from typing import Protocol, runtime_checkable

from app.ai_pipeline.registry import (
    STAGE_ASR,
    STAGE_MT,
    STAGE_TTS,
    ProviderRegistry,
    ProviderSpec,
)
from app.config import settings

logger = logging.getLogger(__name__)

# 有効なステージ（プラグインはこのいずれかへ登録する）。
_VALID_STAGES: frozenset[str] = frozenset({STAGE_ASR, STAGE_MT, STAGE_TTS})

# ステージ契約: 実体が備えるべきメソッド名（解決時に検証する）。
STAGE_REQUIRED_METHODS: dict[str, tuple[str, ...]] = {
    STAGE_ASR: ("transcribe_audio", "transcribe_with_detection"),
    STAGE_MT: ("translate_text",),
    STAGE_TTS: ("synthesize",),
}


class PluginError(Exception):
    """プラグイン登録・契約違反を表す例外。"""


# ============================================================
# ステージ契約（プラグイン著者向けの型ガイド）
# ============================================================
@runtime_checkable
class ASRStage(Protocol):
    """ASR ステージ契約。name 属性と 2 メソッドを備えること。"""

    name: str

    async def transcribe_audio(self, audio_data: bytes, language: str) -> str: ...

    async def transcribe_with_detection(
        self, audio_data: bytes, hint_language: str = "multi"
    ) -> tuple[str, str]: ...


@runtime_checkable
class MTStage(Protocol):
    """MT（テキスト翻訳）ステージ契約。"""

    name: str

    async def translate_text(
        self, text: str, source_language: str, target_language: str
    ) -> str: ...


@runtime_checkable
class TTSStage(Protocol):
    """TTS ステージ契約。合成失敗・非対応は None を返す。"""

    name: str

    async def synthesize(self, text: str, language: str) -> bytes | None: ...


# ============================================================
# 契約検証
# ============================================================
def verify_stage_contract(stage: str, instance: object) -> bool:
    """実体が指定ステージの必須メソッドを備えるか検証する（純ロジック）。

    入力: ステージ名と実体オブジェクト。
    出力: すべての必須メソッドが callable として存在すれば True。
    注意点: Protocol の runtime_checkable はメソッド有無のみ確認するため、ここでは
        呼び出し可能性まで明示的に確認する（属性が非関数の場合を弾く）。
    """
    required = STAGE_REQUIRED_METHODS.get(stage)
    if not required:
        return False
    return all(callable(getattr(instance, m, None)) for m in required)


def _verifying_factory(stage: str, name: str, factory: Callable[[], object]):
    """factory をラップし、生成実体の契約を解決時に検証する。

    契約違反（必須メソッド欠落）は PluginError を送出し、黙って壊れた実体を
    パイプラインへ流さない（解決時フェイルファスト）。
    """

    def _wrapped() -> object:
        instance = factory()
        if not verify_stage_contract(stage, instance):
            required = STAGE_REQUIRED_METHODS.get(stage, ())
            raise PluginError(
                f"プラグイン {stage}/{name} が契約違反: "
                f"必須メソッド {list(required)} を満たしません"
            )
        return instance

    return _wrapped


# ============================================================
# 登録 API（プラグイン著者が呼ぶ公開関数）
# ============================================================
def register_plugin(
    registry: ProviderRegistry,
    *,
    name: str,
    stage: str,
    factory: Callable[[], object],
    required_env: list[str] | None = None,
    available: Callable[[], bool] | None = None,
    fallback: str | None = None,
    allow_override: bool = False,
    verify: bool = True,
) -> None:
    """外部プロバイダー実体を registry へ登録する（契約検証・衝突防止付き）。

    入力: 対象 registry、スロット名 name、ステージ stage、実体生成 factory、
        必要 env・可用性判定・fallback（任意）。allow_override で既存名の上書き可否、
        verify で解決時の契約検証の有無を制御する。
    出力: なし（副作用として registry へ ProviderSpec を登録）。
    注意点: stage 不正・name 空は PluginError。既存 (stage,name) がある場合は
        allow_override=True でなければ PluginError（コアの黙殺上書きを防ぐ）。
    """
    if not name:
        raise PluginError("プラグイン name は必須です")
    if stage not in _VALID_STAGES:
        raise PluginError(
            f"未知の stage: {stage!r}（許可={sorted(_VALID_STAGES)}）"
        )
    if not callable(factory):
        raise PluginError("factory は呼び出し可能である必要があります")
    if name in registry.names(stage) and not allow_override:
        raise PluginError(
            f"既存プロバイダー {stage}/{name} の上書きは allow_override=True が必要です"
        )
    effective_factory = _verifying_factory(stage, name, factory) if verify else factory
    spec = ProviderSpec(
        name=name,
        stage=stage,
        factory=effective_factory,
        required_env=required_env or [],
        available=available if available is not None else _default_available,
        fallback=fallback,
    )
    registry.register(spec)
    logger.info("[Plugin] 登録: %s/%s（fallback=%s）", stage, name, fallback)


def _default_available() -> bool:
    """既定の可用性（常に利用可能）。registry._always_available と同義。"""
    return True


# ============================================================
# プラグイン読み込み（設定駆動・fail-safe）
# ============================================================
def _provider_count(registry: ProviderRegistry) -> int:
    """registry に登録済みの全ステージのプロバイダー総数を数える。"""
    return sum(len(registry.names(s)) for s in _VALID_STAGES)


def load_plugin_module(
    registry: ProviderRegistry,
    module_path: str,
    *,
    allow_override: bool = False,
) -> int:
    """1 プラグインモジュールを import し registry へ登録する（登録件数を返す）。

    プラグインモジュールは次のいずれかを公開する:
        - register(registry): 任意の登録処理を行う関数（推奨・完全な制御）。
        - PLUGINS: dict のリスト。各 dict は register_plugin の引数
          （name/stage/factory/required_env?/available?/fallback?）を持つ。
    入力: 対象 registry・import パス・上書き可否。
    出力: 登録できたプロバイダー件数（失敗時 0）。
    注意点: import 失敗・register 例外・不正定義は当該モジュールのみログしてスキップし、
        コアを壊さない（例外を上位へ伝播しない）。
    """
    try:
        module = importlib.import_module(module_path)
    except Exception as e:  # noqa: BLE001 - import 失敗はコアを壊さない
        logger.warning("[Plugin] モジュール import 失敗: %s（%s）", module_path, e)
        return 0

    register_fn = getattr(module, "register", None)
    if callable(register_fn):
        # register() は任意個のプロバイダーを登録しうるため、登録前後の総数差分で
        # 実際に増えた件数を数える（1 固定だと 0 登録や複数登録を誤って報告する）。
        before = _provider_count(registry)
        try:
            register_fn(registry)
        except Exception as e:  # noqa: BLE001 - プラグイン側の失敗はコアを壊さない
            logger.warning("[Plugin] %s.register 実行エラー: %s", module_path, e)
            return 0
        added = _provider_count(registry) - before
        logger.info("[Plugin] %s.register を実行（登録 %d 件）", module_path, added)
        return added

    specs = getattr(module, "PLUGINS", None)
    if not isinstance(specs, list):
        logger.warning(
            "[Plugin] %s は register() も PLUGINS(list) も公開していません",
            module_path,
        )
        return 0

    count = 0
    for raw in specs:
        try:
            register_plugin(
                registry,
                name=str(raw["name"]),
                stage=str(raw["stage"]),
                factory=raw["factory"],
                required_env=raw.get("required_env"),
                available=raw.get("available"),
                fallback=raw.get("fallback"),
                allow_override=raw.get("allow_override", allow_override),
                verify=raw.get("verify", True),
            )
            count += 1
        except (PluginError, KeyError, TypeError) as e:
            logger.warning("[Plugin] %s の不正な定義をスキップ: %s", module_path, e)
    return count


def _parse_module_paths(raw: str) -> list[str]:
    """カンマ区切りの import パス列を正規化する（空要素除去）。"""
    return [p.strip() for p in raw.split(",") if p.strip()]


def load_configured_plugins(registry: ProviderRegistry) -> int:
    """settings に従いプラグインを読み込む（総登録件数を返す・fail-safe）。

    出力: 登録できたプロバイダー総件数（無効・未設定時は 0）。
    注意点: enable_provider_plugins=False・未設定なら何もしない。各モジュールの失敗は
        独立に握られ、他モジュールやコアへ波及しない。
    """
    if not settings.enable_provider_plugins:
        return 0
    raw = (settings.provider_plugins or "").strip()
    if not raw:
        return 0
    total = 0
    for module_path in _parse_module_paths(raw):
        total += load_plugin_module(registry, module_path)
    logger.info("[Plugin] 設定プラグイン読み込み完了: 合計 %d 件", total)
    return total
