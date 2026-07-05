"""
LAMS 会議室APIルート
会議室の作成・一覧・取得
"""

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.ai_pipeline.providers.minutes import MinutesRequest, get_minutes_provider
from app.auth.dependencies import get_current_user
from app.config import settings
from app.db.database import get_db
from app.db.models import (
    MeetingMode,
    MeetingSession,
    Room,
    TranscriptSegment,
    User,
)
from app.languages import get_enabled_languages
from app.rooms.manager import room_manager
from app.webrtc.persistence import get_or_create_session
from app.webrtc.supervisor import agent_supervisor
from app.webrtc.token import LiveKitNotConfiguredError, create_join_token

router = APIRouter()
logger = logging.getLogger(__name__)

_VALID_MODES = {m.value for m in MeetingMode}


def _validate_language_routes(routes: dict | None) -> dict:
    """language_routes の最小検証。"""
    if not routes:
        return {}
    for key, override in routes.items():
        if not isinstance(override, dict):
            raise ValueError(f"language_routes['{key}'] は object である必要があります")
        mode = override.get("mode")
        if mode is not None and mode not in _VALID_MODES:
            raise ValueError(f"language_routes['{key}'].mode が不正です: {mode}")
    return routes


class RoomCreate(BaseModel):
    """会議室作成リクエスト"""

    name: str
    description: str | None = None
    allowed_languages: list[str] | None = None
    default_audio_mode: str = "original"  # デフォルトは原声
    allow_mode_switch: bool = True
    is_private: bool = False  # 私有会議（他ユーザーの一覧に非表示）
    # 会議の既定モード（a/b/hybrid）。新規セッションの初期 mode となる（Phase 3）。
    # モード2（ASR→翻訳→TTS）は hearing 主線 1 本で字幕＋翻訳音声を生成するため A を既定とする。
    # HYBRID は reading 主線で MT を二重に行い無駄なので明日のリリースでは使わない。
    default_mode: str = MeetingMode.A.value
    enable_openai_s2s: bool = True  # 聞く主線（S2S 翻訳音声）の会議レベル許可
    language_routes: dict = {}  # 言語ペア単位の主線/プロバイダー上書き

    @field_validator("default_mode")
    @classmethod
    def _check_mode(cls, v: str) -> str:
        if v not in _VALID_MODES:
            raise ValueError(f"default_mode は {sorted(_VALID_MODES)} のいずれかです")
        return v

    @field_validator("language_routes")
    @classmethod
    def _check_routes(cls, v: dict) -> dict:
        return _validate_language_routes(v)


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


async def _safe_participant_count(room_id: str) -> int:
    """Redis 障害時でも部屋APIを落とさない参加者数取得。"""
    try:
        return await room_manager.count_participants(room_id)
    except Exception:
        return 0


@router.post("", response_model=RoomResponse, status_code=status.HTTP_201_CREATED)
async def create_room(
    data: RoomCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> RoomResponse:
    """新規会議室作成"""
    enabled_languages = await get_enabled_languages(db)
    allowed_languages = data.allowed_languages or enabled_languages
    invalid_languages = [
        lang for lang in allowed_languages if lang not in set(enabled_languages)
    ]
    if invalid_languages:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "会議室で許可する言語はシステム有効言語の範囲内で指定してください: "
                + ", ".join(invalid_languages)
            ),
        )
    room = Room(
        name=data.name,
        description=data.description,
        creator_id=user.id,
        allowed_languages=allowed_languages,
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
    try:
        await room_manager.create_room_state(room.id)
    except Exception as e:
        logger.error("[Room] state 初期化失敗のため会議室作成を取り消します: room=%s err=%s", room.id, e)
        await db.delete(room)
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="会議室状態の初期化に失敗しました。時間をおいて再試行してください。",
        ) from e

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
                participant_count=await _safe_participant_count(room.id),
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
        participant_count=await _safe_participant_count(room.id),
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
    await get_or_create_session(room.id)
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


class SessionSummaryResponse(BaseModel):
    """会議回の要約情報。"""

    id: str
    started_at: str
    ended_at: str | None
    is_active: bool
    mode: str


class TranscriptResponse(BaseModel):
    """会議記録レスポンス"""

    room_id: str
    room_name: str
    selected_session_id: str | None
    sessions: list[SessionSummaryResponse]
    subtitles: list[SubtitleResponse]
    total: int


async def _load_room_sessions(
    db: AsyncSession, room_id: str
) -> list[MeetingSession]:
    """room 配下の会議回一覧を新しい順で取得する。"""
    result = await db.execute(
        select(MeetingSession)
        .where(MeetingSession.room_id == room_id)
        .order_by(MeetingSession.started_at.desc())
    )
    return list(result.scalars().all())


async def _resolve_session_id(
    db: AsyncSession, room_id: str, session_id: str | None
) -> tuple[str | None, list[MeetingSession]]:
    """対象 session_id を解決する。未指定時は active、無ければ最新を選ぶ。"""
    sessions = await _load_room_sessions(db, room_id)
    if session_id is not None:
        if not any(session.id == session_id for session in sessions):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="指定された会議セッションが見つかりません",
            )
        return session_id, sessions
    active = next((session for session in sessions if session.is_active), None)
    if active is not None:
        return active.id, sessions
    latest = sessions[0] if sessions else None
    return (latest.id if latest is not None else None), sessions


def _to_session_summary(session: MeetingSession) -> SessionSummaryResponse:
    """会議回モデルをレスポンスへ変換する。"""
    return SessionSummaryResponse(
        id=session.id,
        started_at=session.started_at.isoformat(),
        ended_at=session.ended_at.isoformat() if session.ended_at else None,
        is_active=session.is_active,
        mode=session.mode,
    )


async def _load_segments(
    db: AsyncSession, room_id: str, session_id: str | None
) -> list[TranscriptSegment]:
    """会議室の文字起こしセグメントを時系列順に取得する（翻訳を eager load）。

    改善.md §13.3/§13.4 の正規化テーブル（TranscriptSegment 1:N TranslationSegment）を
    旧 Subtitle の代替として読む。async では遅延ロード不可のため selectinload を使う。
    """
    query = (
        select(TranscriptSegment)
        .where(TranscriptSegment.room_id == room_id)
        .options(selectinload(TranscriptSegment.translations))
        .order_by(TranscriptSegment.created_at.asc())
    )
    if session_id is not None:
        query = query.where(TranscriptSegment.session_id == session_id)
    result = await db.execute(query)
    return list(result.scalars().all())


@router.get("/{room_id}/transcript", response_model=TranscriptResponse)
async def get_room_transcript(
    room_id: str,
    lang: str | None = None,  # 出力言語（指定しない場合は全言語）
    session_id: Annotated[
        str | None, Query(description="対象の会議セッションID")
    ] = None,
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

    selected_session_id, sessions = await _resolve_session_id(db, room_id, session_id)
    # 文字起こしセグメントを取得（時系列順、翻訳付き）
    segments = await _load_segments(db, room_id, selected_session_id)

    # ユーザー情報を取得してマッピング
    user_ids = list({s.speaker_id for s in segments})
    if user_ids:
        result = await db.execute(select(User).where(User.id.in_(user_ids)))
        users_list = result.scalars().all()
        users_map = {u.id: u.display_name for u in users_list}
    else:
        users_map = {}

    # レスポンス構築（旧 Subtitle と同一形状を維持＝フロント無改修）
    subtitle_responses = []
    for s in segments:
        translations = {t.target_language: t.translated_text for t in s.translations}
        if lang:
            translations = (
                {lang: translations[lang]}
                if lang in translations
                else {}
            )

        subtitle_responses.append(
            SubtitleResponse(
                id=s.id,
                speaker_id=s.speaker_id,
                speaker_name=users_map.get(s.speaker_id, "不明"),
                original_text=s.text,
                original_language=s.source_language,
                translations=translations,
                timestamp=s.created_at.isoformat(),
            )
        )

    return TranscriptResponse(
        room_id=room.id,
        room_name=room.name,
        selected_session_id=selected_session_id,
        sessions=[_to_session_summary(session) for session in sessions],
        subtitles=subtitle_responses,
        total=len(subtitle_responses),
    )


class MinutesResponse(BaseModel):
    """議事録レスポンス（要約・決定事項・ToDo）"""

    room_id: str
    room_name: str
    session_id: str | None
    output_language: str
    summary: str
    decisions: list[str]
    action_items: list[str]
    provider: str
    segment_count: int  # 議事録生成に用いた発言数


def _build_transcript_text(
    segments: list[TranscriptSegment], users_map: dict[str, str]
) -> str:
    """セグメント列を「話者名: 原文」行へ整形し議事録 LLM 入力用に結合する"""
    lines = [
        f"{users_map.get(s.speaker_id, '不明')}: {s.text}"
        for s in segments
        if s.text and s.text.strip()
    ]
    return "\n".join(lines)


@router.get("/{room_id}/minutes", response_model=MinutesResponse)
async def get_room_minutes(
    room_id: str,
    lang: str = "ja",  # 議事録の出力言語
    session_id: Annotated[
        str | None, Query(description="対象の会議セッションID")
    ] = None,
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

    selected_session_id, _sessions = await _resolve_session_id(db, room_id, session_id)
    # 文字起こしセグメントを時系列順に取得し話者名でマッピングする
    segments = await _load_segments(db, room_id, selected_session_id)
    user_ids = list({s.speaker_id for s in segments})
    if user_ids:
        result = await db.execute(select(User).where(User.id.in_(user_ids)))
        users_map = {u.id: u.display_name for u in result.scalars().all()}
    else:
        users_map = {}

    transcript_text = _build_transcript_text(segments, users_map)
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
        session_id=selected_session_id,
        output_language=lang,
        summary=minutes.summary,
        decisions=minutes.decisions,
        action_items=minutes.action_items,
        provider=minutes.provider,
        segment_count=len(segments),
    )
