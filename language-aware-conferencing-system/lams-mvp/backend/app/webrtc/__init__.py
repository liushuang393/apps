"""
WebRTC / LiveKit トランスポート層（Phase 3 C1）。

WS を廃止し WebRTC/LiveKit へ一本化するための薄い境界。AI コア
（HybridOrchestrator / ModeRouter）は transport 非依存のまま、ここで
トークン発行・OutputSink・Agent Gateway を LiveKit へ結線する。

注意: 標準ライブラリ名 `livekit` との衝突を避けるためパッケージ名は `webrtc`。
"""
