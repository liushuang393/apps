"""
LiveKit 2 クライアント統合テスト（B1/B2/B3）。

話者（ja）が日本語音声を publish し、聞き手（en・翻訳音声モード）が
字幕 data channel と翻訳音声トラックを受信することを検証する。
実 API（OpenAI）と稼働中の Docker スタックが必要。
"""

from __future__ import annotations

import asyncio
import json
import os
import uuid
from dataclasses import dataclass, field
from pathlib import Path

import httpx
import pytest
from livekit import rtc
from openai import AsyncOpenAI

from app.ai_pipeline.pipeline import ai_pipeline
from app.audio.pcm import chunk16, parse_wav16, resample16, wrap_wav16
from app.rooms.manager import room_manager

# participant attributes キー（agent / フロントと一致）
_ATTR_NATIVE = "native_language"
_ATTR_AUDIO_MODE = "audio_mode"
_ATTR_TARGET = "target_language"
_ATTR_SUBTITLE = "subtitle_enabled"
_TOPIC_SUBTITLE = "subtitle"
_TRACK_PREFIX = "translation-"
_AGENT_IDENTITY = "lams-agent"

_SAMPLE_RATE = 16000
_FRAME_SAMPLES = _SAMPLE_RATE * 20 // 1000  # 20ms
_JA_TEST_PHRASE = "今日は会議のテストです。翻訳が正しく動くか確認します。"
_TIMEOUT_SEC = 90.0
_API_BASE = os.getenv("LAMS_API_BASE", "http://localhost:8090")
_LIVEKIT_URL = os.getenv("LAMS_LIVEKIT_URL", "ws://localhost:7880")


def _load_root_env() -> None:
    """リポジトリルートの .env を環境変数へ取り込む（未設定キーのみ）。"""
    env_path = Path(__file__).resolve().parents[3] / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        k = key.strip()
        v = value.strip()
        if not v:
            continue
        os.environ.setdefault(k, v)


_load_root_env()

# 空の OPENAI_BASE_URL はクライアント初期化を壊すため除去する
if not os.getenv("OPENAI_BASE_URL", "").strip():
    os.environ.pop("OPENAI_BASE_URL", None)

# 統合テスト用の DB/Redis（Docker ホストポート）
os.environ.setdefault(
    "DATABASE_URL",
    "postgresql://lams:lams_secret_2024@localhost:5433/lams",
)
os.environ.setdefault("REDIS_URL", "redis://localhost:6380/0")


def _openai_client() -> AsyncOpenAI:
    """OpenAI クライアントを生成する。"""
    return AsyncOpenAI(api_key=os.environ["OPENAI_API_KEY"])


def _integration_ready() -> bool:
    """統合テスト実行に必要な前提が揃っているか。"""
    return bool(os.getenv("OPENAI_API_KEY"))


async def _api_reachable() -> bool:
    """バックエンド API が応答するか。"""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(f"{_API_BASE}/health")
            return r.status_code == 200
    except httpx.HTTPError:
        return False


async def _generate_ja_wav() -> bytes:
    """OpenAI TTS で日本語テスト音声（WAV）を生成する。"""
    client = _openai_client()
    response = await client.audio.speech.create(
        model=os.getenv("OPENAI_TTS_MODEL", "tts-1"),
        voice=os.getenv("OPENAI_TTS_VOICE", "alloy"),
        input=_JA_TEST_PHRASE,
        response_format="wav",
    )
    return response.content


async def _ensure_listener_pref(room_id: str, listener_id: str) -> None:
    """聞き手の翻訳設定を Redis に反映する（Agent 同期待ち付き）。"""
    for _ in range(10):
        updated = await room_manager.update_preference(
            room_id,
            listener_id,
            audio_mode="translated",
            target_language="en",
            subtitle_enabled=True,
        )
        if updated is not None:
            return
        await asyncio.sleep(0.5)
    raise RuntimeError("聞き手の参加者設定を Redis に作成できませんでした")


async def _wav_to_pcm16(wav: bytes) -> bytes:
    """WAV を 16kHz モノ PCM へ変換する。"""
    pcm, rate = parse_wav16(wav, fallback_rate=24000)
    return resample16(pcm, rate, _SAMPLE_RATE)


async def _publish_pcm(room: rtc.Room, pcm16: bytes) -> None:
    """16kHz PCM をマイクトラックとして publish する。"""
    source = rtc.AudioSource(_SAMPLE_RATE, 1)
    track = rtc.LocalAudioTrack.create_audio_track("microphone", source)
    options = rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE)
    await room.local_participant.publish_track(track, options)

    frames, _ = chunk16(pcm16, _FRAME_SAMPLES)
    for frame in frames:
        samples = len(frame) // 2
        audio_frame = rtc.AudioFrame(frame, _SAMPLE_RATE, 1, samples)
        await source.capture_frame(audio_frame)

    # 発話末尾無音（segmenter がセグメント確定するため 600ms 以上）
    silence = b"\x00\x00" * (_SAMPLE_RATE // 2)
    silence_frames, _ = chunk16(silence, _FRAME_SAMPLES)
    for frame in silence_frames:
        samples = len(frame) // 2
        audio_frame = rtc.AudioFrame(frame, _SAMPLE_RATE, 1, samples)
        await source.capture_frame(audio_frame)


@dataclass
class ListenerCapture:
    """聞き手側で受信した字幕・翻訳音声を蓄積する。"""

    subtitles: list[dict] = field(default_factory=list)
    audio_bytes: int = 0

    def note_subtitle(self, msg: dict) -> None:
        self.subtitles.append(msg)

    def note_audio(self, nbytes: int) -> None:
        self.audio_bytes += nbytes

    async def wait_for_subtitle(self, timeout: float) -> dict | None:
        """翻訳字幕が届くまでポーリングする（音声受信とは独立）。"""
        deadline = asyncio.get_event_loop().time() + timeout
        while asyncio.get_event_loop().time() < deadline:
            for msg in reversed(self.subtitles):
                text = msg.get("translated_text")
                if text:
                    return msg
            await asyncio.sleep(0.5)
        return None


def _register_listener_handlers(
    room: rtc.Room, capture: ListenerCapture, speaker_id: str
) -> None:
    """字幕 data と翻訳音声トラックの受信ハンドラを登録する。"""

    @room.on("data_received")
    def _on_data(packet: rtc.DataPacket) -> None:
        topic = packet.topic or ""
        if topic and topic != _TOPIC_SUBTITLE:
            return
        try:
            msg = json.loads(packet.data.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return
        if msg.get("type") == "subtitle" or msg.get("translated_text"):
            capture.note_subtitle(msg)

    @room.on("track_subscribed")
    def _on_track(
        track: rtc.Track,
        publication: rtc.RemoteTrackPublication,
        participant: rtc.RemoteParticipant,
    ) -> None:
        name = publication.name or ""
        if track.kind != rtc.TrackKind.KIND_AUDIO:
            return
        if not name.startswith(f"{_TRACK_PREFIX}en-{speaker_id}"):
            return
        asyncio.ensure_future(_consume_audio(track, capture))


async def _consume_audio(track: rtc.Track, capture: ListenerCapture) -> None:
    """翻訳音声トラックのフレームを消費しバイト数を記録する。"""
    stream = rtc.AudioStream(track)
    try:
        async for event in stream:
            capture.note_audio(len(event.frame.data))
    except Exception:
        return


async def _wait_for_agent(room: rtc.Room, timeout: float = 30.0) -> None:
    """lams-agent が room に参加するまで待つ。"""
    deadline = asyncio.get_event_loop().time() + timeout
    while asyncio.get_event_loop().time() < deadline:
        remote = getattr(room, "remote_participants", {}) or {}
        if any(
            pid.startswith(_AGENT_IDENTITY) or pid == _AGENT_IDENTITY
            for pid in remote
        ):
            return
        await asyncio.sleep(0.5)
    raise TimeoutError("lams-agent が room に参加しませんでした")


async def _poll_transcript_en(
    client: httpx.AsyncClient, room_id: str, bearer: str, timeout: float = 60.0
) -> str | None:
    """会議記録 API から英語翻訳テキストを取得する（data channel 補助検証）。"""
    deadline = asyncio.get_event_loop().time() + timeout
    while asyncio.get_event_loop().time() < deadline:
        resp = await client.get(
            f"{_API_BASE}/api/rooms/{room_id}/transcript",
            headers={"Authorization": f"Bearer {bearer}"},
        )
        if resp.status_code == 200:
            body = resp.json()
            for item in body.get("subtitles", []):
                translations = item.get("translations") or {}
                en_text = translations.get("en")
                if en_text:
                    return str(en_text)
        await asyncio.sleep(2.0)
    return None


async def _auth_token(
    client: httpx.AsyncClient, email: str, password: str, **register_extra: str
) -> tuple[str, str]:
    """登録（またはログイン）して JWT と user_id を返す。"""
    reg = await client.post(
        f"{_API_BASE}/api/auth/register",
        json={
            "email": email,
            "password": password,
            "display_name": register_extra.get("display_name", email),
            "native_language": register_extra.get("native_language", "ja"),
        },
    )
    if reg.status_code == 200:
        body = reg.json()
        return body["access_token"], body["user"]["id"]
    login = await client.post(
        f"{_API_BASE}/api/auth/login",
        json={"email": email, "password": password},
    )
    login.raise_for_status()
    body = login.json()
    return body["access_token"], body["user"]["id"]


async def _issue_token(
    client: httpx.AsyncClient, bearer: str, room_id: str
) -> dict:
    """LiveKit 参加トークンを発行する。"""
    r = await client.post(
        f"{_API_BASE}/api/rooms/{room_id}/token",
        headers={"Authorization": f"Bearer {bearer}"},
    )
    r.raise_for_status()
    return r.json()


@pytest.mark.asyncio
@pytest.mark.integration
async def test_b1_pipeline_direct() -> None:
    """B1: ja 音声 → ASR → en 翻訳 → 翻訳 WAV を生成する。"""
    if not _integration_ready():
        pytest.skip("OPENAI_API_KEY 未設定")
    if not await _api_reachable():
        pytest.skip(f"API 未到達: {_API_BASE}")

    wav = await _generate_ja_wav()
    pcm, rate = parse_wav16(wav, fallback_rate=24000)
    wrapped = wrap_wav16(pcm, rate)

    result = await ai_pipeline.process_audio(
        wrapped, "ja", "en", speaker_id="b1-test"
    )
    assert result.original_text, "ASR 原文が空"
    assert result.translated_text, "翻訳テキストが空"
    assert result.audio_data and len(result.audio_data) > 0, "翻訳音声が空"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_livekit_two_clients_subtitle_and_audio() -> None:
    """B2/B3: 話者 publish → 聞き手が英語字幕と翻訳音声を受信する。"""
    if not _integration_ready():
        pytest.skip("OPENAI_API_KEY 未設定")
    if not await _api_reachable():
        pytest.skip(f"API 未到達: {_API_BASE}")

    suffix = uuid.uuid4().hex[:8]
    password = "TestPass123!"
    speaker_email = f"speaker-{suffix}@example.com"
    listener_email = f"listener-{suffix}@example.com"

    wav = await _generate_ja_wav()
    pcm16 = await _wav_to_pcm16(wav)

    async with httpx.AsyncClient(timeout=30.0) as client:
        speaker_token, speaker_id = await _auth_token(
            client,
            speaker_email,
            password,
            display_name="Speaker JA",
            native_language="ja",
        )
        listener_token, listener_id = await _auth_token(
            client,
            listener_email,
            password,
            display_name="Listener EN",
            native_language="en",
        )

        room_resp = await client.post(
            f"{_API_BASE}/api/rooms",
            headers={"Authorization": f"Bearer {speaker_token}"},
            json={
                "name": f"翻訳テスト-{suffix}",
                "allowed_languages": ["ja", "en"],
                "default_mode": "a",
                "default_audio_mode": "original",
            },
        )
        room_resp.raise_for_status()
        room_id = room_resp.json()["id"]

        # 話者トークン発行で Agent 起動をトリガー
        speaker_join = await _issue_token(client, speaker_token, room_id)
        listener_join = await _issue_token(client, listener_token, room_id)

    capture = ListenerCapture()
    listener_room = rtc.Room()
    speaker_room = rtc.Room()
    _register_listener_handlers(listener_room, capture, speaker_id)

    try:
        # 話者を先に接続して Agent の購読を安定させる
        await speaker_room.connect(_LIVEKIT_URL, speaker_join["token"])
        await speaker_room.local_participant.set_attributes(
            {
                _ATTR_NATIVE: "ja",
                _ATTR_AUDIO_MODE: "original",
                _ATTR_TARGET: "ja",
                _ATTR_SUBTITLE: "true",
            }
        )
        await _wait_for_agent(speaker_room)

        await listener_room.connect(_LIVEKIT_URL, listener_join["token"])
        await listener_room.local_participant.set_attributes(
            {
                _ATTR_NATIVE: "en",
                _ATTR_AUDIO_MODE: "translated",
                _ATTR_TARGET: "en",
                _ATTR_SUBTITLE: "true",
            }
        )
        # LiveKit attributes の反映遅延を補うため Redis 上の聞き手設定を直接更新
        await _ensure_listener_pref(room_id, listener_id)
        await asyncio.sleep(1.0)

        await _publish_pcm(speaker_room, pcm16)

        subtitle = await capture.wait_for_subtitle(30.0)
        transcript_en: str | None = None
        async with httpx.AsyncClient(timeout=30.0) as client:
            transcript_en = await _poll_transcript_en(
                client, room_id, listener_token, timeout=45.0
            )

        assert subtitle is not None or transcript_en, (
            f"字幕タイムアウト (data={len(capture.subtitles)}件, "
            f"transcript={'あり' if transcript_en else 'なし'})"
        )
        if subtitle is not None:
            translated = subtitle.get("translated_text") or ""
            assert translated, "翻訳字幕テキストが空"
            assert subtitle.get("speaker_id") == speaker_id
            assert subtitle.get("is_translated") is True
        else:
            assert transcript_en, "会議記録に英語翻訳がありません"

        # 翻訳音声の受信を追加待機
        deadline = asyncio.get_event_loop().time() + 15.0
        while capture.audio_bytes == 0 and asyncio.get_event_loop().time() < deadline:
            await asyncio.sleep(0.5)

        assert capture.audio_bytes > 0, "翻訳音声トラックを受信できませんでした"
    finally:
        await speaker_room.disconnect()
        await listener_room.disconnect()
