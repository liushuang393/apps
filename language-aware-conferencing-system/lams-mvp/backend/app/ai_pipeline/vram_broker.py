"""
VRAM Broker / Model Manager v1（改善案 §6.1）：12GB GPU 前提のモデル常駐調停。

12GB では全大モデルを常駐できないため、ステージ優先度に従って GPU 上のモデルを
ロード/退避する調停器。実時間 ASR > TTS 首パケット > 翻訳バッチ > 後編集/要約 LLM の
順で優先し、予算超過時は「使用中でない」低優先度モデルを LRU で退避する。

設計原則:
    - 純ロジック＋依存注入（loader/clock を注入）→ GPU 無し環境でも単体テスト可能。
    - 実モデルのロードは loader（呼び出し側が渡す）に委譲し、本モジュールは
      予算会計・優先度退避・バージョンロック・アイドル卸載のみを担う。
    - 使用中（参照カウント>0）のモデルは絶対に退避しない（実行中リクエスト保護）。
    - ロード/退避は asyncio.Lock で直列化し、並行 acquire の競合を防ぐ。
"""

import asyncio
import contextlib
import logging
import time
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

# ステージ優先度（大きいほど優先。予算逼迫時は小さい方から退避）。
PRIORITY_ASR = 40  # 実時間 ASR（最優先）
PRIORITY_TTS = 30  # TTS 首パケット
PRIORITY_MT = 20  # 翻訳バッチ
PRIORITY_LLM = 10  # 後編集 / 要約 LLM

# 既定の GPU 予算（MB）。12GB のうち実運用に回せる目安（フラグメント/他用途を除く）。
_DEFAULT_BUDGET_MB = 11000


class VRAMCapacityError(RuntimeError):
    """使用中モデルの保護下では要求サイズを確保できない（呼び出し側は CPU/雲へ縮退）。"""


@dataclass
class _Entry:
    """常駐モデル 1 件の会計エントリ。"""

    key: str
    model: object
    size_mb: int
    priority: int
    version: str
    last_used: float
    refs: int = 0  # 参照カウント（>0 の間は退避不可）


@dataclass
class VRAMBroker:
    """GPU 予算内でモデル常駐を調停するブローカー（純ロジック・注入可能）。"""

    budget_mb: int = _DEFAULT_BUDGET_MB
    clock: Callable[[], float] = time.monotonic
    _entries: dict[str, _Entry] = field(default_factory=dict)
    _lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    @property
    def used_mb(self) -> int:
        """現在の常駐合計サイズ（MB）。"""
        return sum(e.size_mb for e in self._entries.values())

    def resident_keys(self) -> list[str]:
        """常駐中モデルのキー一覧（登録順）。"""
        return list(self._entries.keys())

    async def get_or_load(
        self,
        key: str,
        *,
        loader: Callable[[], object],
        size_mb: int,
        priority: int,
        version: str,
    ) -> object:
        """モデルを常駐させ実体を返す（参照カウント+1）。使用後は release 必須。

        既に同一 version で常駐していれば即返す。version 不一致は再ロードする。
        予算超過時は使用中でない低優先度モデルを退避して確保する。確保できなければ
        VRAMCapacityError を送出する（呼び出し側は CPU/雲へフォールバックする）。
        """
        async with self._lock:
            existing = self._entries.get(key)
            if existing is not None and existing.version == version:
                existing.refs += 1
                existing.last_used = self.clock()
                return existing.model
            if existing is not None:
                # バージョン更新: 使用中なら差し替え不可（旧参照が生きているため）。
                if existing.refs > 0:
                    raise VRAMCapacityError(
                        f"使用中モデルのバージョン更新は不可: {key}"
                    )
                logger.info("[VRAM] バージョン更新のため再ロード: %s", key)
                # 退避経路と同じく明示的に解放してから外す（GC 任せにしない）。
                self._call_close(existing)
                del self._entries[key]

            self._ensure_capacity(size_mb, priority)
            # loader は数秒かかる GPU ロードを含むためスレッドへ退避し、イベント
            # ループ（全 room・LiveKit ハートビート）の凍結を防ぐ。lock は await を
            # またいで保持され、同一/他キーの並行ロードは直列化されたまま。
            model = await asyncio.to_thread(loader)
            entry = _Entry(
                key=key,
                model=model,
                size_mb=size_mb,
                priority=priority,
                version=version,
                last_used=self.clock(),
                refs=1,
            )
            self._entries[key] = entry
            logger.info(
                "[VRAM] ロード完了: %s (size=%dMB, used=%dMB/%dMB)",
                key,
                size_mb,
                self.used_mb,
                self.budget_mb,
            )
            return model

    def _ensure_capacity(self, size_mb: int, priority: int) -> None:
        """予算内に size_mb を収めるため、退避可能な低優先度モデルを LRU で卸す。

        退避対象は「参照カウント 0（使用中でない）かつ優先度 <= 要求優先度」の
        モデルのみ。優先度昇順→last_used 昇順（古い順）に卸し、それでも入らなければ
        VRAMCapacityError を送出する。
        """
        if size_mb > self.budget_mb:
            raise VRAMCapacityError(
                f"要求サイズが予算超過: {size_mb}MB > budget {self.budget_mb}MB"
            )
        while self.used_mb + size_mb > self.budget_mb:
            victim = self._pick_victim(priority)
            if victim is None:
                raise VRAMCapacityError(
                    f"退避可能モデルが無く確保不能: 要求={size_mb}MB, "
                    f"used={self.used_mb}MB, budget={self.budget_mb}MB"
                )
            self._evict(victim)

    def _pick_victim(self, incoming_priority: int) -> _Entry | None:
        """退避候補（refs==0 かつ priority<=incoming）を優先度→古さ順で 1 件選ぶ。"""
        candidates = [
            e
            for e in self._entries.values()
            if e.refs == 0 and e.priority <= incoming_priority
        ]
        if not candidates:
            return None
        return min(candidates, key=lambda e: (e.priority, e.last_used))

    def _evict(self, entry: _Entry) -> None:
        """1 エントリを退避する（実 GPU 解放は loader 側の GC/close に委ねる）。"""
        self._call_close(entry)
        del self._entries[entry.key]
        logger.info(
            "[VRAM] 退避: %s (freed=%dMB, used=%dMB)",
            entry.key,
            entry.size_mb,
            self.used_mb,
        )

    @staticmethod
    def _call_close(entry: _Entry) -> None:
        """モデルが close/unload を持つ場合は呼び出す（無ければ GC に委ねる）。"""
        for attr in ("unload", "close"):
            fn = getattr(entry.model, attr, None)
            if callable(fn):
                with contextlib.suppress(Exception):
                    fn()
                return

    async def release(self, key: str) -> None:
        """参照カウントを 1 減らす（0 で退避候補になる。実卸載はしない）。"""
        async with self._lock:
            entry = self._entries.get(key)
            if entry is None:
                return
            entry.refs = max(0, entry.refs - 1)
            entry.last_used = self.clock()

    @contextlib.asynccontextmanager
    async def use(
        self,
        key: str,
        *,
        loader: Callable[[], object],
        size_mb: int,
        priority: int,
        version: str,
    ) -> AsyncIterator[object]:
        """acquire→release を保証する async コンテキスト（推奨経路）。"""
        model = await self.get_or_load(
            key,
            loader=loader,
            size_mb=size_mb,
            priority=priority,
            version=version,
        )
        try:
            yield model
        finally:
            await self.release(key)

    async def warmup(
        self,
        key: str,
        *,
        loader: Callable[[], object],
        size_mb: int,
        priority: int,
        version: str,
    ) -> None:
        """モデルを事前ロードして即 release する（首パケット遅延の平準化）。"""
        await self.get_or_load(
            key,
            loader=loader,
            size_mb=size_mb,
            priority=priority,
            version=version,
        )
        await self.release(key)

    async def unload_idle(self, max_idle_s: float) -> list[str]:
        """max_idle_s を超えてアイドルの未使用モデルを卸す。卸したキーを返す。"""
        async with self._lock:
            now = self.clock()
            targets = [
                e
                for e in self._entries.values()
                if e.refs == 0 and (now - e.last_used) >= max_idle_s
            ]
            for entry in targets:
                self._evict(entry)
            return [e.key for e in targets]


# モジュール唯一の既定ブローカー（stage アダプターはこれを共有する）。
broker = VRAMBroker()
