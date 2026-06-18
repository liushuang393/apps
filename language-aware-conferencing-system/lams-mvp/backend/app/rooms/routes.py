"""
LAMS 会議室APIルート
会議室の作成・一覧・取得
"""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai_pipeline.providers.minutes import MinutesRequest, get_minutes_provider
from app.auth.dependencies import get_current_user
from app.config import settings
from app.db.database import get_db
from app.db.models import MeetingMode, Room, Subtitle, User
from app.rooms.manager import room_manager
from app.webrtc.supervisor import agent_supervisor
from app.webrtc.token import LiveKitNotConfiguredError, create_join_token

router = APIRouter()

_VALID_MODES = {m.value for m in MeetingMode}


class RoomCreate(BaseModel):
    """会議室作成リクエスト"""

    name: str
    description: str | None = None
    allowed_languages: list[str] = ["ja", "en", "zh", "vi"]
    default_audio_mode: str = "original"  # デフォルトは原声
    allow_mode_switch: bool = True
    is_private: bool = False  # 私有会議（他ユーザーの一覧に非表示）
    # 会議の既定モード（a/b/hybrid）。新規セッションの初期 mode となる（Phase 3）。
    default_mode: str = MeetingMode.HYBRID.value
    enable_openai_s2s: bool = True  # 聞く主線（S2S 翻訳音声）の会議レベル許可
    language_routes: dict = {}  # 言語ペア単位の主線/プロバイダー上書き

    @field_validator("default_mode")
    @classmethod
    def _check_mode(cls, v: str) -> str:
        if v not in _VALID_MODES:
            raise ValueError(f"default_mode は {sorted(_VALID_MODES)} のいずれかです")
        return v


class RoomResponse(BaseModel):
    """会議室レスポンス"""

    id: str
    name: str
    description: str | None
    creator_id: str
    allowed_languages: list[str]
    default_audio_mode: str
    allow_mode_switch: bool
    is_private: bool  # 私有/公開状態
    is_active: bool
    participant_count: int = 0
    # 会議モード設定（Phase 3 ハイブリッド 2 主線）
    default_mode: str = MeetingMode.HYBRID.value
    enable_openai_s2s: bool = True
    language_routes: dict = {}

    class Config:
        from_attributes = True


@router.post("", response_model=RoomResponse, status_code=status.HTTP_201_CREATED)
async def create_room(
    data: RoomCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> RoomResponse:
    """新規会議室作成"""
    room = Room(
        name=data.name,
        description=data.description,
        creator_id=user.id,
        allowed_languages=data.allowed_languages,
        default_audio_mode=data.default_audio_mode,
        allow_mode_switch=data.allow_mode_switch,
        is_private=data.is_private,
        default_mode=data.default_mode,
        enable_openai_s2s=data.enable_openai_s2s,
        language_routes=data.language_routes,
    )
    db.add(room)
    await db.commit()
    await db.refresh(room)

    # Redis に会議室状態を作成
    await room_manager.create_room_state(room.id)

    return RoomResponse(
        id=room.id,
        name=room.name,
        description=room.description,
        creator_id=room.creator_id,
        allowed_languages=room.allowed_languages,
        default_audio_mode=room.default_audio_mode,
        allow_mode_switch=room.allow_mode_switch,
        is_private=room.is_private,
        is_active=room.is_active,
        default_mode=room.default_mode,
        enable_openai_s2s=room.enable_openai_s2s,
        language_routes=room.language_routes or {},
    )


@router.get("")
async def list_rooms(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> dict:
    """
    アクティブな会議室一覧取得
    私有会議は作成者のみ表示
    """
    from sqlalchemy import or_

    # 公開会議 OR 自分が作成した私有会議のみ表示
    result = await db.execute(
        select(Room)
        .where(Room.is_active.is_(True))
        .where(or_(Room.is_private.is_(False), Room.creator_id == user.id))
        .order_by(Room.created_at.desc())
    )
    rooms = result.scalars().all()

    response_rooms = []
    for room in rooms:
        participants = await room_manager.get_participants(room.id)
        response_rooms.append(
            RoomResponse(
                id=room.id,
                name=room.name,
                description=room.description,
                creator_id=room.creator_id,
                allowed_languages=room.allowed_languages,
                default_audio_mode=room.default_audio_mode,
                allow_mode_switch=room.allow_mode_switch,
                is_private=room.is_private,
                is_active=room.is_active,
                participant_count=len(participants),
                default_mode=room.default_mode,
                enable_openai_s2s=room.enable_openai_s2s,
                language_routes=room.language_routes or {},
            )
        )

    return {"rooms": response_rooms, "total": len(response_rooms)}


@router.get("/{room_id}", response_model=RoomResponse)
async def get_room(
    room_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> RoomResponse:
    """
    会議室詳細取得
    私有会議は作成者のみアクセス可能
    """
    result = await db.execute(select(Room).where(Room.id == room_id))
    room = result.scalar_one_or_none()

    if not room:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="会議室が見つかりません"
        )

    # 私有会議は作成者以外アクセス不可
    if room.is_private and room.creator_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="この会議室にはアクセスできません",
        )

    participants = await room_manager.get_participants(room.id)

    return RoomResponse(
        id=room.id,
        name=room.name,
        description=room.description,
        creator_id=room.creator_id,
        allowed_languages=room.allowed_languages,
        default_audio_mode=room.default_audio_mode,
        allow_mode_switch=room.allow_mode_switch,
        is_private=room.is_private,
        is_active=room.is_active,
        participant_count=len(participants),
        default_mode=room.default_mode,
        enable_openai_s2s=room.enable_openai_s2s,
        language_routes=room.language_routes or {},
    )


class JoinTokenResponse(BaseModel):
    """LiveKit 参加トークンレスポンス（フロントの livekit-client が接続に使用）"""

    server_url: str  # 接続先 LiveKit URL（公開 URL 優先）
    token: str  # 署名済み JWT
    room_id: str  # 参加対象 room（= LiveKit room 名）
    identity: str  # 参加者 identity（= user.id）


@router.post("/{room_id}/token", response_model=JoinTokenResponse)
async def issue_livekit_token(
    room_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> JoinTokenResponse:
    """
    会議室参加用の LiveKit トークンを発行する（Phase 3 C1：単一トランスポート）。
    - 私有会議は作成者のみアクセス可能（get_room と同一ポリシー）。
    - LiveKit 鍵未設定時は 503（起動は阻害しない設計）。
    """
    result = await db.execute(select(Room).where(Room.id == room_id))
    room = result.scalar_one_or_none()
    if not room:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="会議室が見つかりません"
        )
    if room.is_private and room.creator_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="この会議室にはアクセスできません",
        )

    try:
        token = create_join_token(
            room_id=room.id,
            identity=user.id,
            display_name=user.display_name,
            agent_name=settings.livekit_agent_name,
        )
    except LiveKitNotConfiguredError as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="WebRTC（LiveKit）は現在無効です（鍵未設定）",
        ) from e

    # 音声フォーク Gateway（Agent worker）を対象 room に常駐させる（冪等・非同期）。
    # autostart 無効時は no-op。トークン発行は Agent 起動の成否に依存しない。
    agent_supervisor.ensure_running(room.id)

    return JoinTokenResponse(
        server_url=settings.get_livekit_ws_url(),
        token=token,
        room_id=room.id,
        identity=user.id,
    )


class SubtitleResponse(BaseModel):
    """字幕レスポンス"""

    id: str
    speaker_id: str
    speaker_name: str
    original_text: str
    original_language: str
    translations: dict
    timestamp: str  # ISO format

    class Config:
        from_attributes = True


class TranscriptResponse(BaseModel):
    """会議記録レスポンス"""

    room_id: str
    room_name: str
    subtitles: list[SubtitleResponse]
    total: int


@router.get("/{room_id}/transcript", response_model=TranscriptResponse)
async def get_room_transcript(
    room_id: str,
    lang: str | None = None,  # 出力言語（指定しない場合は全言語）
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TranscriptResponse:
    """
    会議記録（字幕履歴）を取得
    - lang パラメータで出力言語を指定可能
    - 全ユーザーが同じ内容を取得（言語のみ異なる可能性）
    """
    # 会議室の存在確認
    result = await db.execute(select(Room).where(Room.id == room_id))
    room = result.scalar_one_or_none()

    if not room:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="会議室が見つかりません"
        )

    # 私有会議は作成者以外アクセス不可（get_room / minutes と同一ポリシー）
    if room.is_private and room.creator_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="この会議室にはアクセスできません",
        )

    # 字幕を取得（時系列順）
    result = await db.execute(
        select(Subtitle)
        .where(Subtitle.room_id == room_id)
        .order_by(Subtitle.timestamp.asc())
    )
    subtitles = result.scalars().all()

    # ユーザー情報を取得してマッピング
    user_ids = list({s.speaker_id for s in subtitles})
    if user_ids:
        result = await db.execute(select(User).where(User.id.in_(user_ids)))
        users_list = result.scalars().all()
        users_map = {u.id: u.display_name for u in users_list}
    else:
        users_map = {}

    # レスポンス構築
    subtitle_responses = []
    for s in subtitles:
        # 指定言語がある場合は翻訳テキストを使用
        if lang and lang in s.translations:
            text = s.translations[lang]
        elif lang and lang == s.original_language:
            text = s.original_text
        else:
            text = s.original_text

        subtitle_responses.append(
            SubtitleResponse(
                id=s.id,
                speaker_id=s.speaker_id,
                speaker_name=users_map.get(s.speaker_id, "不明"),
                original_text=s.original_text if not lang else text,
                original_language=s.original_language,
                translations=s.translations,
                timestamp=s.timestamp.isoformat(),
            )
        )

    return TranscriptResponse(
        room_id=room.id,
        room_name=room.name,
        subtitles=subtitle_responses,
        total=len(subtitle_responses),
    )


class MinutesResponse(BaseModel):
    """議事録レスポンス（要約・決定事項・ToDo）"""

    room_id: str
    room_name: str
    output_language: str
    summary: str
    decisions: list[str]
    action_items: list[str]
    provider: str
    segment_count: int  # 議事録生成に用いた発言数


def _build_transcript_text(subtitles: list[Subtitle], users_map: dict[str, str]) -> str:
    """字幕列を「話者名: 原文」行へ整形し議事録 LLM 入力用に結合する"""
    lines = [
        f"{users_map.get(s.speaker_id, '不明')}: {s.original_text}"
        for s in subtitles
        if s.original_text and s.original_text.strip()
    ]
    return "\n".join(lines)


@router.get("/{room_id}/minutes", response_model=MinutesResponse)
async def get_room_minutes(
    room_id: str,
    lang: str = "ja",  # 議事録の出力言語
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MinutesResponse:
    """
    会議記録から議事録（要約・決定事項・ToDo）をオンデマンド生成する。
    - LLM(GPT優先/Gemini fallback)で生成。未設定時は 503。
    - 私有会議は作成者のみアクセス可能。
    """
    result = await db.execute(select(Room).where(Room.id == room_id))
    room = result.scalar_one_or_none()
    if not room:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="会議室が見つかりません"
        )
    if room.is_private and room.creator_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="この会議室にはアクセスできません",
        )

    provider = get_minutes_provider()
    if provider is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="議事録生成は現在無効です（LLM 未設定）",
        )

    # 字幕を時系列順に取得し話者名でマッピングする
    result = await db.execute(
        select(Subtitle)
        .where(Subtitle.room_id == room_id)
        .order_by(Subtitle.timestamp.asc())
    )
    subtitles = list(result.scalars().all())
    user_ids = list({s.speaker_id for s in subtitles})
    if user_ids:
        result = await db.execute(select(User).where(User.id.in_(user_ids)))
        users_map = {u.id: u.display_name for u in result.scalars().all()}
    else:
        users_map = {}

    transcript_text = _build_transcript_text(subtitles, users_map)
    req = MinutesRequest(
        transcript=transcript_text, output_language=lang, meeting_title=room.name
    )
    try:
        minutes = await provider.generate_minutes(req)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="議事録の生成に失敗しました",
        ) from e

    return MinutesResponse(
        room_id=room.id,
        room_name=room.name,
        output_language=lang,
        summary=minutes.summary,
        decisions=minutes.decisions,
        action_items=minutes.action_items,
        provider=minutes.provider,
        segment_count=len(subtitles),
    )
