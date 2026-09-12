"""
LiveKit Agent スーパーバイザ（Phase 3 C1-6）：room 毎の in-process Agent 常駐管理。

トークン発行（rooms.routes）契機で、対象 room の LiveKit Agent worker を
バックエンドプロセス内に 1 つだけ起動する（冪等）。WS 廃止後、音声フォーク
Gateway（app.webrtc.agent.run_agent）を実際に駆動する唯一の起動経路。

設計原則:
    - 起動は settings.livekit_enabled() かつ settings.livekit_agent_autostart が
      共に真のときのみ（テスト・外部 worker 運用では副作用ゼロ）。
    - 同一 room の重複起動を防ぐ（room_id → Task の登録簿で管理）。
    - Agent の接続失敗・切断はログのみ（トークン発行や API を阻害しない）。
"""

import asyncio
import contextlib
import logging

from app.config import settings
from app.webrtc.agent import run_agent

logger = logging.getLogger(__name__)


class AgentSupervisor:
    """room 毎に in-process の LiveKit Agent worker を 1 つだけ常駐させる。"""

    def __init__(self) -> None:
        # room_id → 起動中の Agent worker タスク（完了時に自動で除去）。
        self._tasks: dict[str, asyncio.Task] = {}

    def ensure_running(self, room_id: str) -> None:
        """対象 room の Agent worker を起動する（冪等・非ブロッキング）。

        既に起動済み（未完了タスクが登録済み）なら何もしない。autostart 無効
        または LiveKit 鍵未設定のときは起動しない。呼び出しは実行中の event loop
        を前提とする（FastAPI の async ハンドラ内から呼ぶこと）。

        Args:
            room_id: Agent を常駐させる対象 room（= LiveKit room 名）。
        """
        if not (settings.livekit_agent_autostart and settings.livekit_enabled()):
            return
        existing = self._tasks.get(room_id)
        if existing is not None and not existing.done():
            return
        task = asyncio.ensure_future(self._run(room_id))
        self._tasks[room_id] = task
        task.add_done_callback(lambda t: self._on_done(room_id, t))

    async def _run(self, room_id: str) -> None:
        """Agent worker 本体（run_agent）を起動する。"""
        logger.info("[Supervisor] Agent 起動: room=%s", room_id)
        await run_agent(room_id)

    def _on_done(self, room_id: str, task: asyncio.Task) -> None:
        """完了タスクを登録簿から外し、異常終了はログする。"""
        if self._tasks.get(room_id) is task:
            self._tasks.pop(room_id, None)
        if not task.cancelled() and task.exception() is not None:
            logger.error(
                "[Supervisor] Agent 異常終了: room=%s err=%s",
                room_id,
                task.exception(),
            )

    async def stop_all(self) -> None:
        """全 Agent worker を停止する（アプリ shutdown 時に使用）。"""
        tasks = list(self._tasks.values())
        for task in tasks:
            task.cancel()
        for task in tasks:
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await task
        self._tasks.clear()


# シングルトンインスタンス（トークン発行ルートから参照する）
agent_supervisor = AgentSupervisor()
