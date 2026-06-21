"""
LiveKit 参加トークン発行（Phase 3 C1）。

会議参加者（フロント）と Agent（サーバ Gateway）向けに、room 限定の
JWT を発行する純ロジック。鍵は config（settings）から取得し、I/O を伴わない
ため単体テストで claims を検証できる。

設計:
    - participant は publish/subscribe/data を許可（音声送受信＋字幕 data channel）。
    - agent は publish/subscribe/data に加え dispatch 名を付与可能。
    - 鍵未設定時は LiveKitNotConfiguredError を送出（呼び出し側で 503 化）。
"""

from livekit import api

from app.config import settings


class LiveKitNotConfiguredError(RuntimeError):
    """LiveKit の API キー/シークレットが未設定で、トークンを発行できない。"""


def create_join_token(
    *,
    room_id: str,
    identity: str,
    display_name: str,
    can_publish: bool = True,
    agent_name: str | None = None,
) -> str:
    """room 限定の LiveKit 参加トークン（JWT）を発行する。

    Args:
        room_id: 参加対象の room 名（LAMS の room.id を流用）。
        identity: 参加者識別子（LocalParticipant.identity となる）。
        display_name: 表示名。
        can_publish: マイク音声を publish 可能にするか（聴講専用なら False）。
        agent_name: 指定時は当該 Agent の dispatch を要求する（任意）。
    Returns:
        署名済み JWT 文字列。
    Raises:
        LiveKitNotConfiguredError: API キー/シークレット未設定時。
    """
    if not settings.livekit_enabled():
        raise LiveKitNotConfiguredError(
            "LIVEKIT_API_KEY / LIVEKIT_API_SECRET が未設定です"
        )

    grants = api.VideoGrants(
        room_join=True,
        room=room_id,
        can_publish=can_publish,
        can_subscribe=True,
        can_publish_data=True,
    )
    token = (
        api.AccessToken(settings.livekit_api_key, settings.livekit_api_secret)
        .with_identity(identity)
        .with_name(display_name)
        .with_grants(grants)
    )
    if agent_name:
        token = token.with_room_config(
            api.RoomConfiguration(agents=[api.RoomAgentDispatch(agent_name=agent_name)])
        )
    return token.to_jwt()
