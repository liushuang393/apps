"""
LAMS WebSocketハンドラー
会議室のリアルタイム通信を管理

設計方針:
- ユーザーが audio_mode を選択（original/translated）
- 字幕は audio_mode に一致する内容のみ表示
- デフォルトは原声モード（翻訳なし）

改善（原声会議機能）:
- 音声は即座に全参加者に配信（ASRを待たない）
- 字幕処理は非同期タスクとして実行（音声配信をブロックしない）
"""

import asyncio
import contextlib
import json
import logging
import uuid
from dataclasses import asdict
from typing import TYPE_CHECKING

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from sqlalchemy import select

from app.ai_pipeline.pipeline import ai_pipeline
from app.audio.vad import has_speech
from app.auth.jwt_handler import decode_token
from app.db.database import async_session
from app.db.models import MeetingSession, Room, Subtitle, User
from app.rooms.manager import room_manager
from app.translate import subtitle_cache
from app.translate.routes import translate_text_simple

if TYPE_CHECKING:
    from app.rooms.schemas import Participant

# 字幕シーケンス番号管理（room_id -> seq）
# 各会議室ごとに単調増加するシーケンス番号を管理
_subtitle_seq: dict[str, int] = {}

# 重複字幕防止用キャッシュ（room_id -> speaker_id -> last_text）
# 同じ話者の連続した同一テキストを除外
_last_subtitle_cache: dict[str, dict[str, str]] = {}

# 会議セッション管理（room_id -> session_id）
# アクティブなセッションIDを保持
_active_sessions: dict[str, str] = {}

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
        logger.debug("send_to_user: room=%s, user=%s, type=%s", room_id, user_id, message.get("type"))
        if room_id in self.rooms and user_id in self.rooms[room_id]:
            try:
                await self.rooms[room_id][user_id].send_json(message)
            except Exception as e:
                logger.warning("WS送信失敗: %s", e)
        else:
            logger.debug("ユーザーが見つかりません: room_exists=%s", room_id in self.rooms)

    async def send_bytes_to_user(self, room_id: str, user_id: str, data: bytes) -> None:
        """特定ユーザーにバイナリを送信"""
        if room_id in self.rooms and user_id in self.rooms[room_id]:
            with contextlib.suppress(Exception):
                await self.rooms[room_id][user_id].send_bytes(data)


# 接続マネージャーインスタンス
conn_mgr = ConnectionManager()


async def get_or_create_session(room_id: str) -> str:
    """
    会議室のアクティブセッションを取得または作成

    セッションライフサイクル:
    - 最初の発言時にセッション開始
    - 全員退室時にセッション終了

    Args:
        room_id: 会議室ID

    Returns:
        session_id: セッションID
    """
    global _active_sessions

    # メモリ内にアクティブセッションがあれば返す
    if room_id in _active_sessions:
        return _active_sessions[room_id]

    # DBでアクティブセッションを確認
    async with async_session() as db:
        result = await db.execute(
            select(MeetingSession).where(
                MeetingSession.room_id == room_id,
                MeetingSession.is_active == True,  # noqa: E712
            )
        )
        session = result.scalar_one_or_none()

        if session:
            _active_sessions[room_id] = session.id
            return session.id

        # 新規セッション作成
        new_session = MeetingSession(room_id=room_id)
        db.add(new_session)
        await db.commit()
        await db.refresh(new_session)

        _active_sessions[room_id] = new_session.id
        logger.info(
            f"[SESSION] 新規セッション開始: room={room_id}, session={new_session.id}"
        )
        return new_session.id


async def end_session(room_id: str) -> None:
    """
    会議セッションを終了（全員退室時に呼び出し）

    Args:
        room_id: 会議室ID
    """
    global _active_sessions

    session_id = _active_sessions.pop(room_id, None)
    if not session_id:
        return

    async with async_session() as db:
        result = await db.execute(
            select(MeetingSession).where(MeetingSession.id == session_id)
        )
        session = result.scalar_one_or_none()
        if session:
            from datetime import datetime, timezone

            session.is_active = False
            session.ended_at = datetime.now(timezone.utc)
            await db.commit()
            logger.info(
                f"[SESSION] セッション終了: room={room_id}, session={session_id}"
            )


async def _process_s2s_translation(
    room_id: str,
    speaker_id: str,
    audio_bytes: bytes,
    source_lang: str,
    target_lang: str,
    user_ids: list[str],
) -> dict:
    """
    S2S Realtime APIで翻訳音声と翻訳字幕を取得・配信

    翻訳音声モードの参加者向け処理:
    1. Realtime APIで音声→翻訳音声+翻訳字幕を取得
    2. 翻訳音声を対象参加者に配信
    3. 翻訳字幕を返却（呼び出し元で配信）

    Args:
        room_id: 会議室ID
        speaker_id: 話者ID
        audio_bytes: 入力音声
        source_lang: 話者の言語
        target_lang: 翻訳先言語
        user_ids: 翻訳音声を受信する参加者IDリスト

    Returns:
        {"target_lang": target_lang, "translated_text": 翻訳字幕}
    """
    try:
        # S2S翻訳実行
        result = await ai_pipeline.process_audio(
            audio_bytes, source_lang, target_lang, speaker_id
        )

        # 翻訳音声がある場合、対象参加者に配信
        if result.audio_data:
            for user_id in user_ids:
                await conn_mgr.send_bytes_to_user(room_id, user_id, result.audio_data)
            logger.info(f"[S2S] 翻訳音声配信: {target_lang} -> {len(user_ids)}人")

        return {
            "target_lang": target_lang,
            "translated_text": result.translated_text,
        }

    except Exception as e:
        logger.warning(f"[S2S] 翻訳エラー ({target_lang}): {e}")
        return {"target_lang": target_lang, "translated_text": ""}


async def process_audio_dual_path(
    room_id: str,
    speaker_id: str,
    audio_bytes: bytes,
    speaker_lang_hint: str,
    participants: dict[str, "Participant"],
) -> None:
    """
    音声処理の双路設計（原声モード / 翻訳音声モード）

    設計思想:
    - フロントエンドからVAD検出済みの完全な発話セグメントが送信される
    - 後端は音声処理をせず、そのままAI APIに渡す
    - 責任境界を明確に分離
    - ★重要：実際の発話言語を検出し、聴取者の目標言語と一致する場合は原声を配信

    処理フロー:
    1. 言語検出: ASRで実際の発話言語を検出
    2. 原声モードの参加者: 原声 + 原文字幕
    3. 翻訳モードの参加者:
       - 目標言語 == 実際の発話言語 → 原声 + 原文字幕
       - 目標言語 != 実際の発話言語 → 翻訳音声 + 翻訳字幕
    """
    try:
        # 最小音声サイズチェック（44バイトWAVヘッダー + 最低8000サンプル = 500ms）
        min_size = 44 + 16000  # 500ms at 16kHz, 16bit
        if len(audio_bytes) < min_size:
            logger.debug(f"[Audio] 音声が短すぎる: {len(audio_bytes)} bytes")
            return

        # VAD検出（フロントエンドで既に検出済みだが念のため）
        if not has_speech(audio_bytes, min_energy=300.0):
            logger.info("[VAD] 音声なし、処理スキップ")
            return

        # ★ 言語検出付きASR実行（実際の発話言語を検出）
        # hint_language="multi" で自動検出、speaker_lang_hintをフォールバックとして使用
        original_text, detected_lang = await ai_pipeline.detect_language(
            audio_bytes, hint_language="multi"
        )

        # 検出失敗時はヒント言語を使用
        if not detected_lang or detected_lang == "multi":
            detected_lang = speaker_lang_hint
            logger.debug(f"[Lang] 言語検出失敗、ヒント使用: {detected_lang}")
        else:
            logger.info(
                f"[Lang] 実際の発話言語を検出: {detected_lang} "
                f"(ヒント={speaker_lang_hint})"
            )

        # 実際の発話言語を使用
        speaker_lang = detected_lang

        if not original_text:
            logger.debug("[ASR] 認識結果なし")
            return

        logger.info(f"[ASR] 認識完了: '{original_text}' (detected_lang={speaker_lang})")

        # 参加者を原声モードと翻訳モードに分類
        # ★注意: 音声は自分自身に送らない（エコー防止）が、字幕は送る
        original_mode_users: list[str] = []
        translated_mode_targets: dict[str, list[str]] = {}  # target_lang -> [user_ids]

        for p in participants.values():
            # ★自分自身には音声を送らない（エコー防止）
            if p.user_id == speaker_id:
                continue
            if p.audio_mode == "original":
                original_mode_users.append(p.user_id)
            else:  # translated
                target_lang = p.target_language or p.native_language
                if target_lang != speaker_lang:
                    if target_lang not in translated_mode_targets:
                        translated_mode_targets[target_lang] = []
                    translated_mode_targets[target_lang].append(p.user_id)
                else:
                    # ★ 目標言語と実際の発話言語が一致 → 原声を送信
                    logger.info(
                        f"[Lang] ユーザー {p.user_id} の目標言語({target_lang}) == "
                        f"発話言語({speaker_lang})、原声モードに切替"
                    )
                    original_mode_users.append(p.user_id)

        # ★ パス1: 原声モード処理（原声即座配信）
        if original_mode_users:
            for user_id in original_mode_users:
                await conn_mgr.send_bytes_to_user(room_id, user_id, audio_bytes)
            logger.info(f"[Audio] 原声配信: {len(original_mode_users)}人")

        # 重複字幕チェック（同じ話者の連続した同一テキストを除外）
        global _last_subtitle_cache
        if room_id not in _last_subtitle_cache:
            _last_subtitle_cache[room_id] = {}

        last_text = _last_subtitle_cache[room_id].get(speaker_id, "")
        if original_text == last_text:
            logger.debug(f"[ASR] 重複字幕をスキップ: '{original_text}'")
            return

        # キャッシュを更新
        _last_subtitle_cache[room_id][speaker_id] = original_text

        # シーケンス番号を取得・インクリメント
        global _subtitle_seq
        if room_id not in _subtitle_seq:
            _subtitle_seq[room_id] = 0
        _subtitle_seq[room_id] += 1
        seq = _subtitle_seq[room_id]

        # 字幕IDを生成（順序保証のため）
        subtitle_id = str(uuid.uuid4())

        # ★ パス2: 翻訳音声モード処理（S2S Realtime API）
        # 翻訳音声と翻訳字幕を同時取得
        translations: dict[str, str] = {}
        s2s_tasks = []
        for target_lang, user_ids in translated_mode_targets.items():
            s2s_tasks.append(
                _process_s2s_translation(
                    room_id,
                    speaker_id,
                    audio_bytes,
                    speaker_lang,
                    target_lang,
                    user_ids,
                )
            )

        # S2S翻訳を並列実行
        if s2s_tasks:
            s2s_results = await asyncio.gather(*s2s_tasks, return_exceptions=True)
            for result in s2s_results:
                if isinstance(result, dict) and result.get("translated_text"):
                    translations[result["target_lang"]] = result["translated_text"]

        # ★改善: 字幕IDベースのオンデマンド翻訳★
        # 1. 原文をRedisにキャッシュ（翻訳リクエスト時に使用）
        # 2. 翻訳モード購読者の言語のみを非同期で翻訳
        # 3. 字幕は即座に配信（翻訳を待たない）

        # 原文をキャッシュ
        await subtitle_cache.store_original(subtitle_id, original_text, speaker_lang)

        # ★字幕翻訳が必要なユーザーの目標言語を収集
        # 注意: 原声モードでも字幕翻訳は必要な場合がある
        needed_langs: set[str] = set()
        for p in participants.values():
            if p.subtitle_enabled:  # 字幕が有効なら翻訳対象
                target_lang = p.target_language or p.native_language
                if target_lang != speaker_lang:
                    needed_langs.add(target_lang)

        # S2S翻訳結果をキャッシュに保存
        for lang, trans_text in translations.items():
            if trans_text:
                await subtitle_cache.store_translation(subtitle_id, lang, trans_text)

        # ★非同期で追加翻訳（字幕配信をブロックしない）
        async def translate_and_cache(tgt_lang: str) -> None:
            """バックグラウンド翻訳タスク"""
            try:
                if await subtitle_cache.mark_translation_pending(subtitle_id, tgt_lang):
                    translated = await translate_text_simple(
                        original_text, speaker_lang, tgt_lang
                    )
                    if translated:
                        await subtitle_cache.store_translation(
                            subtitle_id, tgt_lang, translated
                        )
                        logger.info(f"[AsyncTranslate] {speaker_lang}->{tgt_lang} 完了")
                    else:
                        logger.warning(
                            f"[AsyncTranslate] 翻訳結果が空: {speaker_lang}->{tgt_lang}"
                        )
            except Exception as e:
                logger.error(
                    f"[AsyncTranslate] 翻訳エラー {speaker_lang}->{tgt_lang}: {e}"
                )

        # S2Sで翻訳されていない言語を非同期で翻訳開始
        for lang in needed_langs:
            if lang not in translations:
                asyncio.create_task(translate_and_cache(lang))

        # ★最小遅延設計: 字幕は原文のみ即時配信★
        # クライアントは subtitle_id で翻訳を取得
        subtitle_message = {
            "type": "subtitle",
            "id": subtitle_id,
            "seq": seq,
            "speaker_id": speaker_id,
            "original_text": original_text,
            "source_language": speaker_lang,
            # translations は含めない（クライアントがIDで取得）
        }

        # ★字幕は全参加者（話者自身を含む）にブロードキャスト★
        # 話者自身も会議記録として自分の発言を見る必要がある
        subtitle_tasks = []
        logger.info(
            f"[SUBTITLE] 配信準備: speaker={speaker_id}, "
            f"participants={list(participants.keys())}, text='{original_text[:30]}...'"
        )
        for p in participants.values():
            if not p.subtitle_enabled:
                logger.debug(f"[SUBTITLE] スキップ（字幕無効）: {p.user_id}")
                continue
            logger.info(
                f"[SUBTITLE] 送信: to={p.user_id}, speaker={speaker_id}, "
                f"is_self={p.user_id == speaker_id}"
            )
            subtitle_tasks.append(
                conn_mgr.send_to_user(room_id, p.user_id, subtitle_message)
            )

        if subtitle_tasks:
            await asyncio.gather(*subtitle_tasks, return_exceptions=True)

        # DB保存（翻訳結果も含む）
        # ★会議セッションを取得または作成（最初の発言時にセッション開始）★
        try:
            session_id = await get_or_create_session(room_id)
            async with async_session() as db:
                subtitle = Subtitle(
                    room_id=room_id,
                    session_id=session_id,
                    speaker_id=speaker_id,
                    original_text=original_text,
                    original_language=speaker_lang,
                    translations=translations,
                )
                db.add(subtitle)
                await db.commit()
        except Exception as e:
            logger.warning(f"字幕DB保存エラー: {e}")

    except Exception as e:
        logger.warning(f"字幕処理エラー: {e}")


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
    logger.info("WS接続開始: user=%s, room=%s", user_id, room_id)
    await conn_mgr.connect(room_id, user_id, ws)

    # 参加者として追加（デフォルト: 原声モード）
    participant = await room_manager.add_participant(
        room_id=room_id,
        user_id=user_id,
        display_name=user.display_name,
        native_language=user.native_language,
        audio_mode=room.default_audio_mode,  # 会議室のデフォルト
        subtitle_enabled=True,
    )

    logger.info("参加者追加完了: user=%s", user_id)

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
    logger.info("[WS DEBUG] Broadcasted user_joined")

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
    logger.info("room_state送信完了、メッセージループ開始")

    try:
        while True:
            data = await ws.receive()
            logger.debug("受信: type=%s", data.get("type"))

            # 接続切断チェック
            if data.get("type") == "websocket.disconnect":
                logger.info("[WS DEBUG] Client disconnected")
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

                elif msg_type == "mic_on":
                    # マイクON状態を更新・通知
                    updated = await room_manager.set_mic_status(room_id, user_id, True)
                    if updated:
                        await conn_mgr.broadcast_json(
                            room_id,
                            {
                                "type": "mic_status_changed",
                                "user_id": user_id,
                                "is_mic_on": True,
                            },
                        )

                elif msg_type == "mic_off":
                    # マイクOFF状態を更新・通知
                    updated = await room_manager.set_mic_status(room_id, user_id, False)
                    if updated:
                        await conn_mgr.broadcast_json(
                            room_id,
                            {
                                "type": "mic_status_changed",
                                "user_id": user_id,
                                "is_mic_on": False,
                            },
                        )

            elif "bytes" in data:
                # ========================================
                # 音声データ処理（原声会議機能 - 改善版）
                # ========================================
                # 設計: 音声即時配信 + 字幕非同期処理
                # 目標遅延: 15-70ms（ASRを待たない）
                # ========================================
                audio_bytes = data["bytes"]

                # WAVヘッダー(44バイト) + 最小PCMデータ(約0.2秒=6400バイト)
                min_audio_size = 44 + 6400
                if not audio_bytes or len(audio_bytes) < min_audio_size:
                    continue

                current_participant = await room_manager.get_participant(
                    room_id, user_id
                )
                if not current_participant:
                    continue

                speaker_lang = current_participant.native_language
                all_participants = await room_manager.get_participants(room_id)

                logger.info(
                    f"[AUDIO] 完全な発話セグメント受信: {len(audio_bytes)} bytes, "
                    f"duration={len(audio_bytes) // 32}ms, "
                    f"speaker={user_id}, lang={speaker_lang}"
                )

                # ★ 双路処理: 原声モード / 翻訳音声モード
                # VAD検出済みの完全な発話セグメントを処理
                # 処理をブロックしないよう非同期タスクとして実行
                audio_task = asyncio.create_task(
                    process_audio_dual_path(
                        room_id,
                        user_id,
                        audio_bytes,
                        speaker_lang,
                        all_participants,
                    )
                )
                # 例外ログ出力
                audio_task.add_done_callback(
                    lambda t: logger.error(f"[AUDIO] タスクエラー: {t.exception()}")
                    if t.done() and not t.cancelled() and t.exception()
                    else None
                )

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

        # 字幕キャッシュのクリーンアップ（このユーザーの分）
        if room_id in _last_subtitle_cache and user_id in _last_subtitle_cache[room_id]:
            del _last_subtitle_cache[room_id][user_id]

        # 会議室に誰もいなくなったらシーケンス番号とキャッシュをリセット
        # ★全員退室時に会議セッションを終了★
        remaining = await room_manager.get_participants(room_id)
        if not remaining:
            _subtitle_seq.pop(room_id, None)
            _last_subtitle_cache.pop(room_id, None)
            await end_session(room_id)

        logger.info(f"[WS] User {user_id} left room {room_id}")
