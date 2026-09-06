"""
Output Manager の composition root 用 factory。

目的:
    processor / orchestrator の配線を 1 箇所に集約し、TransportAdapter seam を統一する。
入力 / 出力:
    TransportAdapter（publish_audio / send_data）を受け取り、DefaultOutputManager を返す。
注意:
    旧 deliver_* のみの Sink は受け付けない。契約不一致は構築時に fail-fast する。
"""

from __future__ import annotations

from app.ai_pipeline.output_manager.adapter import TransportAdapter
from app.ai_pipeline.output_manager.manager import DefaultOutputManager
from app.ai_pipeline.revision_authority import RevisionAuthority


def resolve_transport_adapter(adapter: TransportAdapter) -> TransportAdapter:
    """TransportAdapter 契約を検証し、そのまま返す。

    publish_audio と send_data の両方を持つ对象のみを受理する。
    旧 OutputSink（deliver_*）は受け付けず TypeError で失敗する。
    """
    publish = getattr(adapter, "publish_audio", None)
    send = getattr(adapter, "send_data", None)
    if not (callable(publish) and callable(send)):
        raise TypeError(
            "TransportAdapter が必要です"
            "（publish_audio と send_data を実装してください）"
        )
    return adapter


def build_default_output_manager(
    adapter: TransportAdapter,
    *,
    revision_authority: RevisionAuthority | None = None,
) -> DefaultOutputManager:
    """本番・テスト共通の DefaultOutputManager を組み立てる。"""
    return DefaultOutputManager(
        adapter=resolve_transport_adapter(adapter),
        revision_authority=revision_authority,
    )
