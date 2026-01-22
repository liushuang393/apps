"""
LAMS WebSocketハンドラー
会議室のリアルタイム通信を管理

設計方針:
- ユーザーが audio_mode を選択（original/translated）
- 字幕は audio_mode に一致する内容のみ表示
- デフォルトは原声モード（翻訳なし）
"""

import asyncio
import contextlib
import json
import logging
from dataclasses import asdict

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from sqlalchemy import select

from app.ai_pipeline.pipeline import ai_pipeline
from app.auth.jwt_handler import decode_token
from app.db.database import async_session
from app.db.models import Room, Subtitle, User
from app.rooms.manager import room_manager

logger = logging.getLogger(__name__)
router = APIRouter()


class ConnectionManager:
    """
    WebSocket接続管理クラス
    各会議室の接続を管理
    """

    def __init__(self) -> None:
        # room_id -> user_id -> WebSocket
        self.rooms: dict[str, dict[str, WebSocket]] = {}
        self._lock = asyncio.Lock()

    async def connect(self, room_id: str, user_id: str, ws: WebSocket) -> None:
        """接続を追加"""
        await ws.accept()
        async with self._lock:
            if room_id not in self.rooms:
                self.rooms[room_id] = {}
            self.rooms[room_id][user_id] = ws

    async def disconnect(self, room_id: str, user_id: str) -> None:
        """接続を削除"""
        async with self._lock:
            if room_id in self.rooms:
                self.rooms[room_id].pop(user_id, None)
                if not self.rooms[room_id]:
                    del self.rooms[room_id]

    async def broadcast_json(
        self, room_id: str, message: dict, exclude_user: str | None = None
    ) -> None:
        """全員にJSONメッセージを送信"""
        if room_id not in self.rooms:
            return
        for user_id, ws in list(self.rooms[room_id].items()):
            if user_id != exclude_user:
                with contextlib.suppress(Exception):
                    await ws.send_json(message)

    async def send_to_user(self, room_id: str, user_id: str, message: dict) -> None:
        """特定ユーザーにJSONを送信"""
        print(f"[WS SEND] send_to_user: room={room_id}, user={user_id}, type={message.get('type')}", flush=True)
        if room_id in self.rooms and user_id in self.rooms[room_id]:
            try:
                await self.rooms[room_id][user_id].send_json(message)
                print(f"[WS SEND] 送信成功: {message.get('type')}", flush=True)
            except Exception as e:
                print(f"[WS SEND] 送信失敗: {e}", flush=True)
        else:
            print(f"[WS SEND] ユーザーが見つかりません: room_exists={room_id in self.rooms}", flush=True)

    async def send_bytes_to_user(self, room_id: str, user_id: str, data: bytes) -> None:
        """特定ユーザーにバイナリを送信"""
        if room_id in self.rooms and user_id in self.rooms[room_id]:
            with contextlib.suppress(Exception):
                await self.rooms[room_id][user_id].send_bytes(data)


# 接続マネージャーインスタンス
conn_mgr = ConnectionManager()


@router.websocket("/room/{room_id}")
async def websocket_room(
    ws: WebSocket,
    room_id: str,
    token: str = Query(...),
) -> None:
    """
    会議室WebSocketエンドポイント

    メッセージタイプ:
    - preference_change: 設定変更（audio_mode, subtitle_enabled, target_language）
    - speaking_start: 発言開始
    - speaking_end: 発言終了
    - bytes: 音声データ
    """
    # トークン検証
    token_data = decode_token(token)
    if not token_data:
        await ws.close(code=4001, reason="無効なトークン")
        return

    user_id = token_data.user_id

    # 会議室とユーザーの存在確認
    async with async_session() as db:
        room_result = await db.execute(select(Room).where(Room.id == room_id))
        room = room_result.scalar_one_or_none()
        if not room or not room.is_active:
            await ws.close(code=4004, reason="会議室が見つかりません")
            return

        user_result = await db.execute(select(User).where(User.id == user_id))
        user = user_result.scalar_one_or_none()
        if not user:
            await ws.close(code=4001, reason="ユーザーが見つかりません")
            return

    # 接続確立（conn_mgr.connect内でws.accept()を呼び出す）
    print(f"[WS INIT] Connecting user {user_id} to room {room_id}", flush=True)
    await conn_mgr.connect(room_id, user_id, ws)
    print(f"[WS INIT] Connected, adding participant...", flush=True)

    # 参加者として追加（デフォルト: 原声モード）
    participant = await room_manager.add_participant(
        room_id=room_id,
        user_id=user_id,
        display_name=user.display_name,
        native_language=user.native_language,
        audio_mode=room.default_audio_mode,  # 会議室のデフォルト
        subtitle_enabled=True,
    )

    print(f"[WS INIT] Participant added to Redis: user_id={user_id}", flush=True)

    # 入室を他の参加者に通知
    await conn_mgr.broadcast_json(
        room_id,
        {
            "type": "user_joined",
            "user_id": user_id,
            "display_name": user.display_name,
            "native_language": user.native_language,
        },
        exclude_user=user_id,
    )
    logger.info(f"[WS DEBUG] Broadcasted user_joined")

    # 現在の部屋状態を送信
    participants = await room_manager.get_participants(room_id)
    logger.info(f"[WS DEBUG] Got participants: {len(participants)}")
    await ws.send_json(
        {
            "type": "room_state",
            "room_id": room_id,
            "room_name": room.name,
            "policy": {
                "allowed_languages": room.allowed_languages,
                "default_audio_mode": room.default_audio_mode,
                "allow_mode_switch": room.allow_mode_switch,
            },
            "participants": [
                {
                    "user_id": p.user_id,
                    "display_name": p.display_name,
                    "native_language": p.native_language,
                    "audio_mode": p.audio_mode,
                }
                for p in participants.values()
            ],
            "your_preference": asdict(participant),
        }
    )
    print(f"[WS DEBUG] Sent room_state, entering message loop...", flush=True)
    logger.info(f"[WS DEBUG] Sent room_state, entering message loop...")

    try:
        while True:
            print(f"[WS DEBUG] Waiting for message from user {user_id}...", flush=True)
            data = await ws.receive()
            print(f"[WS DEBUG] Received data type: {data.get('type')}, keys: {list(data.keys())}", flush=True)
            logger.info(f"[WS DEBUG] Received data type: {data.get('type')}, keys: {list(data.keys())}")

            # 接続切断チェック
            if data.get("type") == "websocket.disconnect":
                logger.info(f"[WS DEBUG] Client disconnected")
                break

            if "text" in data:
                # JSONメッセージ処理
                message = json.loads(data["text"])
                msg_type = message.get("type")

                if msg_type == "preference_change":
                    # 設定変更
                    if not room.allow_mode_switch:
                        await ws.send_json(
                            {
                                "type": "error",
                                "message": "この会議室では設定変更が許可されていません",
                            }
                        )
                        continue

                    new_audio_mode = message.get("audio_mode")
                    new_subtitle = message.get("subtitle_enabled")
                    new_target_lang = message.get("target_language")

                    # 言語が許可されているか確認
                    if (
                        new_target_lang
                        and new_target_lang not in room.allowed_languages
                    ):
                        await ws.send_json(
                            {
                                "type": "error",
                                "message": f"言語 {new_target_lang} は許可されていません",
                            }
                        )
                        continue

                    updated = await room_manager.update_preference(
                        room_id,
                        user_id,
                        audio_mode=new_audio_mode,
                        subtitle_enabled=new_subtitle,
                        target_language=new_target_lang,
                    )

                    if updated:
                        await ws.send_json(
                            {
                                "type": "preference_updated",
                                "preference": asdict(updated),
                            }
                        )
                        # 他の参加者にも通知
                        await conn_mgr.broadcast_json(
                            room_id,
                            {
                                "type": "user_preference_changed",
                                "user_id": user_id,
                                "audio_mode": updated.audio_mode,
                            },
                            exclude_user=user_id,
                        )

                elif msg_type == "speaking_start":
                    await room_manager.set_active_speaker(room_id, user_id)
                    await conn_mgr.broadcast_json(
                        room_id,
                        {"type": "speaking_start", "user_id": user_id},
                    )

                elif msg_type == "speaking_end":
                    await room_manager.set_active_speaker(room_id, None)
                    await conn_mgr.broadcast_json(
                        room_id,
                        {"type": "speaking_end", "user_id": user_id},
                    )

            elif "bytes" in data:
                # 音声データ処理
                audio_bytes = data["bytes"]
                print(f"[WS AUDIO] 受信: {len(audio_bytes) if audio_bytes else 0} bytes from user {user_id}", flush=True)
                logger.info(f"[WS AUDIO] 受信: {len(audio_bytes) if audio_bytes else 0} bytes from user {user_id}")
                # WAVヘッダー(44バイト) + 最小PCMデータ(約0.2秒=6400バイト)
                # 16kHz, 16bit, mono: 0.2秒 = 16000 * 0.2 * 2 = 6400バイト
                min_audio_size = 44 + 6400
                if not audio_bytes or len(audio_bytes) < min_audio_size:
                    # 音声データが短すぎる場合はスキップ（ASR認識不可）
                    logger.info(
                        f"[WS AUDIO] 音声データが短すぎます: {len(audio_bytes) if audio_bytes else 0} bytes < {min_audio_size}"
                    )
                    continue

                current_participant = await room_manager.get_participant(
                    room_id, user_id
                )
                if not current_participant:
                    print(f"[WS AUDIO] 参加者が見つかりません: room_id={room_id}, user_id={user_id}", flush=True)
                    continue

                speaker_lang = current_participant.native_language
                all_participants = await room_manager.get_participants(room_id)

                # 翻訳結果キャッシュ（同じ言語ペアは1回だけ処理）
                # key: target_lang, value: TranslationResult
                translation_cache: dict = {}
                # 原文ASR結果（1回だけ取得）
                original_asr_result = None

                print(f"[WS AUDIO] 処理開始: speaker_lang={speaker_lang}, participants={len(all_participants)}", flush=True)

                # 各参加者の設定に基づいて配信
                for p in all_participants.values():
                    is_self = p.user_id == user_id

                    # 自分自身の場合: 音声は送信しない、字幕のみ送信
                    if is_self:
                        print(f"[WS AUDIO] 自分への字幕処理: subtitle_enabled={p.subtitle_enabled}", flush=True)
                        if p.subtitle_enabled:
                            # 自分の設定言語に基づいて字幕を生成
                            target_lang = p.target_language or p.native_language
                            print(f"[WS AUDIO] 自分の字幕: target_lang={target_lang}, speaker_lang={speaker_lang}", flush=True)
                            if target_lang == speaker_lang:
                                # 同じ言語：原文を表示
                                if original_asr_result is None:
                                    logger.info(f"[WS AUDIO] ASR開始...")
                                    original_asr_result = await ai_pipeline.process_audio(
                                        audio_bytes, speaker_lang, speaker_lang, user_id
                                    )
                                    logger.info(f"[WS AUDIO] ASR完了: '{original_asr_result.original_text}'")
                                if original_asr_result.original_text:
                                    logger.info(f"[WS AUDIO] 自分に字幕送信: '{original_asr_result.original_text}'")
                                    await conn_mgr.send_to_user(
                                        room_id,
                                        p.user_id,
                                        {
                                            "type": "subtitle",
                                            "speaker_id": user_id,
                                            "text": original_asr_result.original_text,
                                            "language": speaker_lang,
                                            "is_translated": False,
                                        },
                                    )
                                else:
                                    logger.info(f"[WS AUDIO] ASR結果が空のため字幕送信なし")
                            else:
                                # 違う言語：翻訳字幕を表示
                                if target_lang in translation_cache:
                                    result = translation_cache[target_lang]
                                else:
                                    result = await ai_pipeline.process_audio(
                                        audio_bytes, speaker_lang, target_lang, user_id
                                    )
                                    translation_cache[target_lang] = result
                                if result.translated_text:
                                    await conn_mgr.send_to_user(
                                        room_id,
                                        p.user_id,
                                        {
                                            "type": "subtitle",
                                            "speaker_id": user_id,
                                            "text": result.translated_text,
                                            "language": target_lang,
                                            "is_translated": True,
                                        },
                                    )
                        continue  # 自分には音声を送信しない

                    if p.audio_mode == "original":
                        # 原声モード: 元の音声をそのまま送信
                        await conn_mgr.send_bytes_to_user(
                            room_id, p.user_id, audio_bytes
                        )

                        # 字幕が有効な場合は原文テキストを送信
                        if p.subtitle_enabled:
                            # ASRで原文を取得（1回だけ実行）
                            if original_asr_result is None:
                                original_asr_result = await ai_pipeline.process_audio(
                                    audio_bytes, speaker_lang, speaker_lang, user_id
                                )
                            # 空でないテキストのみ送信
                            if original_asr_result.original_text:
                                await conn_mgr.send_to_user(
                                    room_id,
                                    p.user_id,
                                    {
                                        "type": "subtitle",
                                        "speaker_id": user_id,
                                        "text": original_asr_result.original_text,
                                        "language": speaker_lang,
                                        "is_translated": False,
                                    },
                                )

                    else:
                        # 翻訳モード: 翻訳済み音声・字幕を送信
                        target_lang = p.target_language or p.native_language

                        if target_lang == speaker_lang:
                            # 同じ言語の場合は原声
                            await conn_mgr.send_bytes_to_user(
                                room_id, p.user_id, audio_bytes
                            )
                            if p.subtitle_enabled:
                                if original_asr_result is None:
                                    original_asr_result = await ai_pipeline.process_audio(
                                        audio_bytes, speaker_lang, speaker_lang, user_id
                                    )
                                # 空でないテキストのみ送信
                                if original_asr_result.original_text:
                                    await conn_mgr.send_to_user(
                                        room_id,
                                        p.user_id,
                                        {
                                            "type": "subtitle",
                                            "speaker_id": user_id,
                                            "text": original_asr_result.original_text,
                                            "language": speaker_lang,
                                            "is_translated": False,
                                        },
                                    )
                        else:
                            # 翻訳処理（同じ言語ペアはキャッシュ再利用）
                            if target_lang in translation_cache:
                                result = translation_cache[target_lang]
                            else:
                                result = await ai_pipeline.process_audio(
                                    audio_bytes, speaker_lang, target_lang, user_id
                                )
                                translation_cache[target_lang] = result

                            # QoS劣化時は字幕フォールバック
                            if result.metrics.should_fallback_to_subtitle:
                                await conn_mgr.send_to_user(
                                    room_id,
                                    p.user_id,
                                    {
                                        "type": "qos_warning",
                                        "level": result.metrics.degradation_level.value,
                                        "message": "遅延が発生しています。字幕モードに切り替えました。",
                                    },
                                )

                            # 翻訳音声があれば送信（なければ原声）
                            if result.audio_data:
                                print(f"[WS TTS] 翻訳音声送信: {len(result.audio_data)} bytes to {p.user_id}", flush=True)
                                await conn_mgr.send_bytes_to_user(
                                    room_id, p.user_id, result.audio_data
                                )
                            else:
                                print(f"[WS TTS] TTS音声なし、原声を送信: {len(audio_bytes)} bytes to {p.user_id}", flush=True)
                                await conn_mgr.send_bytes_to_user(
                                    room_id, p.user_id, audio_bytes
                                )

                            # 翻訳字幕を送信（空でないテキストのみ）
                            if p.subtitle_enabled and result.translated_text:
                                await conn_mgr.send_to_user(
                                    room_id,
                                    p.user_id,
                                    {
                                        "type": "subtitle",
                                        "speaker_id": user_id,
                                        "text": result.translated_text,
                                        "language": target_lang,
                                        "is_translated": True,
                                        "latency_ms": result.metrics.total_latency_ms,
                                    },
                                )

                # 字幕をデータベースに保存（原文がある場合のみ）
                if original_asr_result and original_asr_result.original_text:
                    # 翻訳結果を収集
                    translations_dict = {}
                    for lang, result in translation_cache.items():
                        if result.translated_text:
                            translations_dict[lang] = result.translated_text

                    # 非同期でデータベースに保存
                    try:
                        async with async_session() as db:
                            subtitle = Subtitle(
                                room_id=room_id,
                                speaker_id=user_id,
                                original_text=original_asr_result.original_text,
                                original_language=speaker_lang,
                                translations=translations_dict,
                            )
                            db.add(subtitle)
                            await db.commit()
                    except Exception as e:
                        logger.warning(f"字幕保存エラー: {e}")

    except WebSocketDisconnect:
        pass
    finally:
        # クリーンアップ
        # 注意: 先に退室通知を送信してから接続を切断する
        # （切断後だとroomが削除されている可能性があるため）
        await conn_mgr.broadcast_json(
            room_id,
            {"type": "user_left", "user_id": user_id},
            exclude_user=user_id,  # 自分自身には送信しない
        )
        await conn_mgr.disconnect(room_id, user_id)
        await room_manager.remove_participant(room_id, user_id)
        logger.info(f"[WS] User {user_id} left room {room_id}")
