#!/usr/bin/env python3
"""公開済み Docker のローカル翻訳を、実 LiveKit 2 クライアントで検証する。

入力: 既知の日本語 WAV と証拠ディレクトリ。クラウド音声生成は利用しない。
出力: 字幕、受信 WAV、DB 観測、設定、後片付け結果を含む JSON。
注意: この実行が作成した利用者・部屋だけを DB から削除する。
設定変更は認証済み管理 API から実行し、選択した local 設定は保持する。
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import re
import secrets
import subprocess
import uuid
import wave
from pathlib import Path

import httpx
from app.audio.pcm import chunk16, parse_wav16, resample16
from verify_local_pipeline import has_voice, inspect_audio

from livekit import rtc

logger = logging.getLogger(__name__)
ROOT = Path(__file__).resolve().parents[1]
SAMPLE_RATE = 16000
FRAME_SAMPLES = 320
WAIT_SECONDS = 300
LOCAL_SETTINGS = {
    "ai_provider": "gpt4o_transcribe",
    "asr_provider": "local",
    "mt_provider": "local",
    "tts_provider": "local",
    "default_mode": "hybrid",
    "enable_partial_subtitles": False,
    "llm_correction_enabled": False,
}

# subprocess 内の DB 処理。所有するテスト ID だけを stdin で受け取る。
DB_SCRIPT = """
import asyncio, json, sys
from sqlalchemy import select, update, delete, or_
from app.db.database import async_session, engine
from app.db.models import Base, User, SystemConfig, TranscriptSegment, TranslationSegment
engine.echo = False
data = json.load(sys.stdin)
async def main():
    async with async_session() as db:
        if data['action'] == 'promote':
            await db.execute(update(User).where(User.id == data['user']).values(role='admin'))
            await db.commit()
            return
        if data['action'] == 'observe':
            result = await db.execute(select(TranscriptSegment.text, TranslationSegment.translated_text).join(TranslationSegment).where(TranscriptSegment.room_id == data['room']))
            sys.stdout.write(json.dumps([list(row) for row in result.all()], ensure_ascii=False))
            return
        tables = Base.metadata.sorted_tables
        predicates = {}
        for table in tables:
            conditions = []
            if table.name == 'users':
                conditions.append(table.c.id.in_(data['users']))
            if table.name == 'rooms' and data.get('room'):
                conditions.append(table.c.id == data['room'])
            for fk in table.foreign_keys:
                parent = fk.column.table
                if parent.name in predicates:
                    conditions.append(fk.parent.in_(select(fk.column).where(predicates[parent.name])))
            if conditions:
                predicates[table.name] = or_(*conditions)
        # 削除前に対象 ID を確定し、親を先に消すことで条件が消失するのを防ぐ。
        rows = {}
        for table in tables:
            if table.name in predicates and 'id' in table.c:
                rows[table.name] = list((await db.execute(select(table.c.id).where(predicates[table.name]))).scalars())
        await db.execute(update(SystemConfig).where(SystemConfig.updated_by.in_(data['users'])).values(updated_by=None))
        for table in reversed(tables):
            if rows.get(table.name):
                await db.execute(delete(table).where(table.c.id.in_(rows[table.name])))
        await db.commit()
asyncio.run(main())
"""


def database(action: str, **data: object) -> str:
    """Docker の実 DB へ限定操作を実行し、標準出力だけを返す。"""
    result = subprocess.run(
        ["docker", "compose", "exec", "-T", "backend", "python", "-c", DB_SCRIPT],
        input=json.dumps({"action": action, **data}),
        cwd=ROOT,
        text=True,
        capture_output=True,
        timeout=60,
        check=False,
    )
    if result.returncode:
        raise RuntimeError(f"DB {action} failed: {result.stderr[-1500:]}")
    return result.stdout


async def run(args: argparse.Namespace, report: dict[str, object]) -> None:
    """認証・設定・音声配信・独立観測を行い、必ず接続とテストデータを片付ける。"""
    users: list[str] = []
    report["user_ids"] = users
    room_id: str | None = None
    speaker_room, listener_room = rtc.Room(), rtc.Room()
    tasks: set[asyncio.Task] = set()
    subtitles: list[dict] = []
    qos_events: list[dict] = []
    audio = bytearray()
    rate = SAMPLE_RATE
    started: float | None = None
    report["latency_reference"] = "input publication start; includes source speech time"
    subtitle_delays: list[dict[str, object]] = []

    async def consume(track: rtc.Track) -> None:
        """聞き手が受信した翻訳音声を 16kHz mono として保存する。"""
        stream = rtc.AudioStream(track, sample_rate=rate, num_channels=1)
        try:
            async for event in stream:
                frame = bytes(event.frame.data)
                audio.extend(frame)
                if started is not None and has_voice(frame, minimum_seconds=0):
                    elapsed = asyncio.get_running_loop().time() - started
                    report.setdefault("first_audio_delay_s", round(elapsed, 3))
                    report["last_audio_delay_s"] = round(elapsed, 3)
        finally:
            await stream.aclose()

    @listener_room.on("data_received")
    def on_data(packet: rtc.DataPacket) -> None:
        """字幕と遅延・縮退イベントを観測し、音声欠落の原因を記録する。"""
        try:
            value = json.loads(packet.data.decode())
            if isinstance(value, dict) and packet.topic == "subtitle":
                subtitles.append(value)
                if started is not None:
                    subtitle_delays.append(
                        {
                            "seq": value.get("seq"),
                            "delay_s": round(
                                asyncio.get_running_loop().time() - started, 3
                            ),
                        }
                    )
            elif isinstance(value, dict):
                qos_events.append({"topic": packet.topic, **value})
        except (ValueError, UnicodeDecodeError):
            logger.warning("字幕データが JSON ではありません")

    @listener_room.on("track_subscribed")
    def on_track(
        track: rtc.Track,
        publication: rtc.RemoteTrackPublication,
        participant: rtc.RemoteParticipant,
    ) -> None:
        """翻訳 Agent の英語音声だけを受信する。"""
        if (
            track.kind == rtc.TrackKind.KIND_AUDIO
            and publication.name.startswith("translation-en-")
            and participant.identity.startswith("sonowa-agent")
        ):
            task = asyncio.create_task(consume(track))
            tasks.add(task)

    try:
        async with httpx.AsyncClient(base_url=args.api, timeout=30) as client:
            actors = []
            for language in ("ja", "en", "ja"):
                credentials = {
                    "email": f"local-{uuid.uuid4().hex}@example.com",
                    "password": secrets.token_urlsafe(24),
                }
                response = await client.post(
                    "/api/auth/register",
                    json={
                        **credentials,
                        "display_name": "Local verification",
                        "native_language": language,
                    },
                )
                response.raise_for_status()
                body = response.json()
                users.append(body["user"]["id"])
                (args.output_dir / "livekit-checkpoint.json").write_text(
                    json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
                )
                actors.append((credentials, body))
            await asyncio.to_thread(database, "promote", user=users[2])
            response = await client.post("/api/auth/login", json=actors[2][0])
            response.raise_for_status()
            admin = {"Authorization": f"Bearer {response.json()['access_token']}"}
            response = await client.get(
                "/api/admin/settings/ai-pipeline", headers=admin
            )
            response.raise_for_status()
            report["settings_before"] = response.json()["effective"]
            if args.require_existing_settings:
                assert all(
                    report["settings_before"][k] == v for k, v in LOCAL_SETTINGS.items()
                )
            response = await client.put(
                "/api/admin/settings/ai-pipeline", headers=admin, json=LOCAL_SETTINGS
            )
            response.raise_for_status()
            report["settings"] = response.json()["effective"]
            assert all(report["settings"][k] == v for k, v in LOCAL_SETTINGS.items())
            if args.configure_only:
                report["configured"] = True
                return
            headers = [
                {"Authorization": f"Bearer {body['access_token']}"}
                for _, body in actors
            ]
            response = await client.post(
                "/api/rooms",
                headers=headers[0],
                json={
                    "name": "Local verification",
                    "allowed_languages": ["ja", "en"],
                    "default_mode": "hybrid",
                },
            )
            response.raise_for_status()
            room_id = response.json()["id"]
            report.update(room_id=room_id, user_ids=users)
            (args.output_dir / "livekit-checkpoint.json").write_text(
                json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            for room, header, language, mode in [
                (speaker_room, headers[0], "ja", "original"),
                (listener_room, headers[1], "en", "translated"),
            ]:
                response = await client.post(
                    f"/api/rooms/{room_id}/token", headers=header
                )
                response.raise_for_status()
                await room.connect(args.livekit, response.json()["token"])
                await room.local_participant.set_attributes(
                    {
                        "native_language": language,
                        "target_language": language,
                        "audio_mode": mode,
                        "subtitle_enabled": "true",
                    }
                )
            report["two_clients_connected"] = True
            if args.connection_only:
                return
            deadline = asyncio.get_running_loop().time() + WAIT_SECONDS
            while not any(
                p.startswith("sonowa-agent") for p in speaker_room.remote_participants
            ):
                if asyncio.get_running_loop().time() > deadline:
                    raise TimeoutError("Agent が参加しません")
                await asyncio.sleep(0.2)
            await asyncio.sleep(2)
            pcm, original_rate = parse_wav16(args.wav.read_bytes(), fallback_rate=48000)
            pcm = resample16(pcm, original_rate, SAMPLE_RATE) + bytes(SAMPLE_RATE * 2)
            source = rtc.AudioSource(SAMPLE_RATE, 1)
            track = rtc.LocalAudioTrack.create_audio_track("microphone", source)
            await speaker_room.local_participant.publish_track(
                track, rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE)
            )
            started = asyncio.get_running_loop().time()
            for frame in chunk16(pcm, FRAME_SAMPLES)[0]:
                await source.capture_frame(
                    rtc.AudioFrame(frame, SAMPLE_RATE, 1, len(frame) // 2)
                )
            await source.wait_for_playout()
            while not has_voice(audio) or not any(
                s.get("translated_text") for s in subtitles
            ):
                if asyncio.get_running_loop().time() - started > WAIT_SECONDS:
                    raise TimeoutError("翻訳字幕または翻訳音声が届きません")
                await asyncio.sleep(0.5)
            while True:
                report["db_translations"] = json.loads(
                    await asyncio.to_thread(database, "observe", room=room_id)
                )
                delivered = " ".join(
                    str(s.get("translated_text", "")) for s in subtitles
                )
                recorded = " ".join(row[1] for row in report["db_translations"])
                if complete_fixture(delivered) and complete_fixture(recorded):
                    break
                if asyncio.get_running_loop().time() - started > WAIT_SECONDS:
                    raise TimeoutError("会議時刻と否定文の両方を受信・永続化できません")
                await asyncio.sleep(3)
            await asyncio.sleep(5)
            report["elapsed_s"] = asyncio.get_running_loop().time() - started
            report["db_translations"] = json.loads(
                await asyncio.to_thread(database, "observe", room=room_id)
            )
            assert report["db_translations"], "永続翻訳記録がありません"
            assert any(
                s.get("speaker_id") == users[0] and s.get("translated_text")
                for s in subtitles
            )
            received = {
                s["translated_text"]
                for s in subtitles
                if s.get("speaker_id") == users[0] and s.get("translated_text")
            }
            assert received.intersection(
                row[1] for row in report["db_translations"]
            ), "受信字幕と DB の翻訳内容が一致しません"
            report["transport_complete"] = True
            report["quality_verdict"] = "pending_received_audio_check"
    finally:
        report["subtitles"] = subtitles
        report["qos_events"] = qos_events
        report["subtitle_delays"] = subtitle_delays
        if room_id and not args.connection_only:
            try:
                report["db_translations"] = json.loads(
                    await asyncio.to_thread(database, "observe", room=room_id)
                )
            except Exception as exc:
                logger.exception("受信後のDB記録照合に失敗")
                report.update(db_observation_error=str(exc), passed=False)
        captured = bytes(audio)
        report["audio_bytes"] = len(captured)
        if captured:
            with wave.open(str(args.output_dir / "livekit-en.wav"), "wb") as wav:
                wav.setnchannels(1)
                wav.setsampwidth(2)
                wav.setframerate(rate)
                wav.writeframes(captured)
            try:
                report["audio"] = inspect_audio(args.output_dir / "livekit-en.wav")
            except ValueError as exc:
                report.update(error=str(exc), passed=False)
        await speaker_room.disconnect()
        await listener_room.disconnect()
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await asyncio.sleep(3)
        if users:
            try:
                await asyncio.to_thread(database, "cleanup", users=users, room=room_id)
                report["cleanup"] = "passed"
            except Exception as exc:
                logger.exception("検証用データの後片付けに失敗")
                report.update(cleanup=str(exc), passed=False)


def complete_fixture(text: str) -> bool:
    """既知文の時刻・会議・ファイル送信の否定が最後まで届いたかを確認する。"""
    value = text.casefold().replace("’", "'")
    return (
        "meeting" in value
        and "file" in value
        and bool(re.search(r"\b(?:10|ten)\b", value))
        and bool(re.search(r"\b(?:not|don't|never)\b", value))
    )


def main() -> int:
    """失敗時にも証拠を保存し、未検証・後片付け失敗を非ゼロで返す。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api", default="http://localhost:8090")
    parser.add_argument("--livekit", default="ws://localhost:7880")
    parser.add_argument("--wav", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--configure-only", action="store_true")
    parser.add_argument("--connection-only", action="store_true")
    parser.add_argument("--require-existing-settings", action="store_true")
    parser.add_argument("--backend-container", default="sonowa-backend-1")
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    report: dict[str, object] = {"passed": False}
    image = subprocess.run(
        ["docker", "inspect", "--format", "{{.Image}}", args.backend_container],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=30,
        check=True,
    ).stdout.strip()
    report["tested_image"] = image
    logging.basicConfig(level=logging.INFO)
    try:
        asyncio.run(run(args, report))
    except Exception as exc:
        logger.exception("LiveKit 検証失敗")
        report.update(error=str(exc), passed=False)
    name = "local-settings.json" if args.configure_only else "livekit.json"
    (args.output_dir / name).write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    success = (
        report.get("transport_complete")
        and report.get("cleanup") == "passed"
        and "error" not in report
        and "db_observation_error" not in report
    ) or (
        (args.configure_only or args.connection_only)
        and (report.get("configured") or report.get("two_clients_connected"))
        and report.get("cleanup") == "passed"
        and "error" not in report
    )
    return 0 if success else 1


if __name__ == "__main__":
    raise SystemExit(main())
