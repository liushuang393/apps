"""
GPT-Realtime S2S プロバイダー

OpenAI GPT-Realtime WebSocket API を使用した音声直接翻訳（200-400ms）
Speech-to-Speech: 音声入力 → 翻訳音声 + テキスト出力

処理フロー:
1. WebSocket接続を確立（wss://api.openai.com/v1/realtime）
2. セッション設定（翻訳指示、音声出力設定）
3. 音声データを送信
4. 翻訳音声 + 翻訳テキストを同時取得

※ WebSocket Realtime APIで最速のS2S翻訳を実現
"""

import asyncio
import base64
import json
import logging

from app.ai_pipeline.providers.base import (
    LANGUAGE_NAMES,
    AIProvider,
    TranslationResult,
    check_api_key,
)
from app.config import settings

logger = logging.getLogger(__name__)

# WebSocket Realtime API エンドポイント
REALTIME_API_URL = "wss://api.openai.com/v1/realtime"


class GPTRealtimeProvider(AIProvider):
    """
    GPT-Realtime S2S プロバイダー（WebSocket API）

    特徴:
    - 超低遅延: 200-400ms（音声→音声直接変換）
    - WebSocket Realtime APIで最速のS2S翻訳
    - 翻訳音声とテキストを同時取得
    - 自然な音声出力
    """

    def __init__(self) -> None:
        """プロバイダー初期化"""
        self._client = None  # REST API用（フォールバック）
        check_api_key(settings.openai_api_key, "OpenAI")

    async def _get_client(self):
        """OpenAI REST APIクライアント取得（フォールバック用）"""
        if self._client is None:
            from openai import AsyncOpenAI

            base_url = settings.openai_base_url or "https://api.openai.com/v1"
            self._client = AsyncOpenAI(
                api_key=settings.openai_api_key,
                base_url=base_url,
            )
            logger.info(f"[GPT-Realtime] REST APIクライアント初期化: {base_url}")
        return self._client

    async def transcribe_audio(self, audio_data: bytes, language: str) -> str:
        """
        音声認識（WebSocket Realtime API transcriptionモード）

        Args:
            audio_data: WAV形式の音声データ
            language: 言語コード

        Returns:
            認識されたテキスト
        """
        min_size = 44 + 8000
        if len(audio_data) < min_size:
            logger.debug(f"[GPT-Realtime] 音声が短すぎる: {len(audio_data)} bytes")
            return ""

        try:
            # WAVからPCM16データを抽出
            pcm_data = self._wav_to_pcm16(audio_data)
            if not pcm_data:
                return ""

            audio_base64 = base64.b64encode(pcm_data).decode("utf-8")
            lang_name = LANGUAGE_NAMES.get(language, language)
            model = settings.openai_realtime_model

            logger.debug(f"[GPT-Realtime] ASR開始: model={model}, lang={lang_name}")

            # WebSocket Realtime APIで音声認識
            result = await self._realtime_transcribe(audio_base64, language)

            # ノイズフィルタリング
            if result and self._is_noise_transcription(result):
                logger.debug(f"[GPT-Realtime] ノイズ除外: '{result}'")
                return ""

            if result:
                logger.info(f"[GPT-Realtime] ASR成功: '{result}'")
            return result

        except Exception as e:
            logger.error(f"[GPT-Realtime] ASRエラー: {e}", exc_info=True)
            # フォールバック: gpt-4o-transcribe
            return await self._transcribe_fallback(audio_data, language)

    def _wav_to_pcm16(self, wav_data: bytes) -> bytes:
        """WAVデータからPCM16データを抽出"""
        try:
            # WAVヘッダーをスキップ（44バイト）
            if len(wav_data) < 44:
                return b""
            # 簡易的にヘッダーをスキップ
            return wav_data[44:]
        except Exception as e:
            logger.warning(f"[GPT-Realtime] WAV解析エラー: {e}")
            return b""

    async def _realtime_transcribe(self, audio_base64: str, language: str) -> str:
        """WebSocket Realtime APIで音声認識"""
        import websockets

        model = settings.openai_realtime_model
        url = f"{REALTIME_API_URL}?model={model}"

        headers = {
            "Authorization": f"Bearer {settings.openai_api_key}",
            "OpenAI-Beta": "realtime=v1",
        }

        try:
            async with websockets.connect(
                url, additional_headers=headers, close_timeout=10
            ) as ws:
                # session.created イベントを待機
                session_ready = False
                while not session_ready:
                    msg = await asyncio.wait_for(ws.recv(), timeout=5.0)
                    event = json.loads(msg)
                    if event.get("type") in ("session.created", "session.updated"):
                        session_ready = True
                        logger.debug("[GPT-Realtime] セッション準備完了")

                # セッション設定（transcriptionモード）
                session_config = {
                    "type": "session.update",
                    "session": {
                        "type": "transcription",
                        "input_audio_format": "pcm16",
                        "input_audio_transcription": {
                            "model": settings.openai_transcribe_model,
                            "language": language if language != "zh" else "zh",
                        },
                    },
                }
                await ws.send(json.dumps(session_config))

                # session.updated を待機
                while True:
                    msg = await asyncio.wait_for(ws.recv(), timeout=5.0)
                    event = json.loads(msg)
                    if event.get("type") == "session.updated":
                        logger.debug("[GPT-Realtime] セッション設定完了")
                        break
                    elif event.get("type") == "error":
                        error_msg = event.get("error", {}).get("message", "Unknown")
                        raise RuntimeError(f"Session update error: {error_msg}")

                # 音声データを送信
                audio_event = {
                    "type": "input_audio_buffer.append",
                    "audio": audio_base64,
                }
                await ws.send(json.dumps(audio_event))

                # 音声送信完了を通知
                await ws.send(json.dumps({"type": "input_audio_buffer.commit"}))

                # レスポンスを待機
                transcript = ""
                timeout = 10.0
                start_time = asyncio.get_event_loop().time()

                while True:
                    if asyncio.get_event_loop().time() - start_time > timeout:
                        logger.warning("[GPT-Realtime] ASRタイムアウト")
                        break

                    try:
                        msg = await asyncio.wait_for(ws.recv(), timeout=5.0)
                        event = json.loads(msg)
                        event_type = event.get("type", "")

                        if (
                            event_type
                            == "conversation.item.input_audio_transcription.completed"
                        ):
                            transcript = event.get("transcript", "").strip()
                            logger.debug(f"[GPT-Realtime] ASR結果: '{transcript}'")
                            break
                        elif event_type == "error":
                            error_msg = event.get("error", {}).get("message", "Unknown")
                            logger.error(f"[GPT-Realtime] APIエラー: {error_msg}")
                            break
                        elif event_type == "input_audio_buffer.committed":
                            logger.debug("[GPT-Realtime] 音声バッファコミット完了")

                    except asyncio.TimeoutError:
                        break

                return transcript

        except Exception as e:
            logger.error(f"[GPT-Realtime] WebSocket ASRエラー: {e}")
            raise

    async def _transcribe_fallback(self, audio_data: bytes, language: str) -> str:
        """フォールバック: gpt-4o-transcribe REST API"""
        import io

        try:
            client = await self._get_client()
            audio_file = io.BytesIO(audio_data)
            audio_file.name = "audio.wav"

            response = await client.audio.transcriptions.create(
                model=settings.openai_transcribe_model,
                file=audio_file,
                language=language if language != "zh" else "zh",
            )
            return response.text.strip() if response.text else ""
        except Exception as e:
            logger.error(f"[GPT-Realtime] フォールバックASRエラー: {e}")
            return f"[ASRエラー: {type(e).__name__}]"

    async def translate_audio(
        self,
        audio_data: bytes,
        source_language: str,
        target_language: str,
    ) -> TranslationResult:
        """
        Speech-to-Speech 翻訳（WebSocket Realtime API）

        Args:
            audio_data: WAV形式の音声データ
            source_language: 元言語コード
            target_language: 翻訳先言語コード

        Returns:
            翻訳結果（音声 + テキスト）
        """
        # 同一言語の場合はASRのみ
        if source_language == target_language:
            original_text = await self.transcribe_audio(audio_data, source_language)
            return TranslationResult(
                source_language=source_language,
                target_language=target_language,
                original_text=original_text,
                translated_text=original_text,
                audio_data=None,
            )

        try:
            src_name = LANGUAGE_NAMES.get(source_language, source_language)
            tgt_name = LANGUAGE_NAMES.get(target_language, target_language)

            # WAVからPCM16データを抽出
            pcm_data = self._wav_to_pcm16(audio_data)
            if not pcm_data:
                return TranslationResult(
                    source_language=source_language,
                    target_language=target_language,
                    original_text="",
                    translated_text="",
                    audio_data=None,
                )

            audio_base64 = base64.b64encode(pcm_data).decode("utf-8")

            logger.info(
                f"[GPT-Realtime] S2S翻訳開始: {src_name} -> {tgt_name}, "
                f"pcm_size={len(pcm_data)} bytes"
            )

            # WebSocket Realtime APIで音声翻訳
            result = await self._realtime_translate(
                audio_base64, source_language, target_language
            )

            if result.translated_text:
                logger.info(f"[GPT-Realtime] S2S翻訳完了: '{result.translated_text}'")
            else:
                logger.info("[GPT-Realtime] 翻訳結果が空（無音または認識失敗）")

            return result

        except Exception as e:
            logger.error(f"[GPT-Realtime] S2S翻訳エラー: {e}", exc_info=True)
            # フォールバック: ASR + 翻訳 + TTS
            logger.info("[GPT-Realtime] フォールバック: 3段階処理")
            return await self._translate_audio_fallback(
                audio_data, source_language, target_language
            )

    async def _realtime_translate(
        self,
        audio_base64: str,
        source_language: str,
        target_language: str,
    ) -> TranslationResult:
        """WebSocket Realtime APIでSpeech-to-Speech翻訳"""
        import websockets

        model = settings.openai_realtime_model
        url = f"{REALTIME_API_URL}?model={model}"
        src_name = LANGUAGE_NAMES.get(source_language, source_language)
        tgt_name = LANGUAGE_NAMES.get(target_language, target_language)

        headers = {
            "Authorization": f"Bearer {settings.openai_api_key}",
            "OpenAI-Beta": "realtime=v1",
        }

        async with websockets.connect(
            url, additional_headers=headers, close_timeout=15
        ) as ws:
            # session.created イベントを待機
            session_ready = False
            while not session_ready:
                msg = await asyncio.wait_for(ws.recv(), timeout=5.0)
                event = json.loads(msg)
                if event.get("type") in ("session.created", "session.updated"):
                    session_ready = True
                    logger.debug("[GPT-Realtime] S2Sセッション準備完了")

            # セッション設定（realtimeモード = S2S）
            # 重要: プロンプトで厳格に翻訳のみを指示し、幻覚を防止
            session_config = {
                "type": "session.update",
                "session": {
                    "type": "realtime",
                    "model": model,
                    "instructions": (
                        f"You are a translation-only system for a multilingual meeting. "
                        f"STRICT RULES:\n"
                        f"1. ONLY translate speech from {src_name} to {tgt_name}.\n"
                        f"2. Do NOT add any comments, greetings, or explanations.\n"
                        f"3. Do NOT speak unless you hear clear speech in the audio.\n"
                        f"4. If audio is silent, unclear, or contains only noise, "
                        f"output NOTHING (stay completely silent).\n"
                        f"5. Translate exactly what is said, nothing more, nothing less.\n"
                        f"6. Do NOT generate speech on your own initiative."
                    ),
                    "input_audio_format": "pcm16",
                    "output_audio_format": "pcm16",
                    "audio": {
                        "output": {"voice": settings.openai_tts_voice},
                    },
                    "input_audio_transcription": {
                        "model": settings.openai_transcribe_model,
                    },
                },
            }
            await ws.send(json.dumps(session_config))

            # session.updated を待機
            while True:
                msg = await asyncio.wait_for(ws.recv(), timeout=5.0)
                event = json.loads(msg)
                if event.get("type") == "session.updated":
                    logger.debug("[GPT-Realtime] S2Sセッション設定完了")
                    break
                elif event.get("type") == "error":
                    error_msg = event.get("error", {}).get("message", "Unknown")
                    raise RuntimeError(f"Session update error: {error_msg}")

            # 音声データを送信
            audio_event = {
                "type": "input_audio_buffer.append",
                "audio": audio_base64,
            }
            await ws.send(json.dumps(audio_event))

            # 音声送信完了を通知
            await ws.send(json.dumps({"type": "input_audio_buffer.commit"}))

            # レスポンス生成を要求
            await ws.send(json.dumps({"type": "response.create"}))

            # レスポンスを収集
            translated_text = ""
            audio_chunks: list[bytes] = []
            timeout = 15.0
            start_time = asyncio.get_event_loop().time()

            while True:
                if asyncio.get_event_loop().time() - start_time > timeout:
                    logger.warning("[GPT-Realtime] S2Sタイムアウト")
                    break

                try:
                    msg = await asyncio.wait_for(ws.recv(), timeout=5.0)
                    event = json.loads(msg)
                    event_type = event.get("type", "")

                    # 音声データ（デルタ）
                    if event_type == "response.audio.delta":
                        delta = event.get("delta", "")
                        if delta:
                            audio_chunks.append(base64.b64decode(delta))

                    # 翻訳テキスト（デルタ）
                    elif event_type == "response.audio_transcript.delta":
                        delta = event.get("delta", "")
                        translated_text += delta

                    # レスポンス完了
                    elif event_type == "response.done":
                        break

                    # エラー
                    elif event_type == "error":
                        error_msg = event.get("error", {}).get("message", "Unknown")
                        logger.error(f"[GPT-Realtime] APIエラー: {error_msg}")
                        raise RuntimeError(f"Realtime API error: {error_msg}")

                except asyncio.TimeoutError:
                    break

            # 音声データを結合してWAV形式に変換
            translated_audio = None
            if audio_chunks:
                pcm_data = b"".join(audio_chunks)
                translated_audio = self._pcm16_to_wav(pcm_data)
                logger.debug(
                    f"[GPT-Realtime] 翻訳音声取得: {len(translated_audio)} bytes"
                )

            return TranslationResult(
                source_language=source_language,
                target_language=target_language,
                original_text="",  # S2Sでは原文テキストは取得しない
                translated_text=translated_text.strip(),
                audio_data=translated_audio,
            )

    def _pcm16_to_wav(self, pcm_data: bytes, sample_rate: int = 24000) -> bytes:
        """PCM16データをWAV形式に変換"""
        import struct

        # WAVヘッダー作成（44バイト）
        num_channels = 1
        bits_per_sample = 16
        byte_rate = sample_rate * num_channels * bits_per_sample // 8
        block_align = num_channels * bits_per_sample // 8
        data_size = len(pcm_data)
        file_size = 36 + data_size

        header = struct.pack(
            "<4sI4s4sIHHIIHH4sI",
            b"RIFF",
            file_size,
            b"WAVE",
            b"fmt ",
            16,  # fmt chunk size
            1,  # PCM format
            num_channels,
            sample_rate,
            byte_rate,
            block_align,
            bits_per_sample,
            b"data",
            data_size,
        )
        return header + pcm_data

    async def _translate_audio_fallback(
        self,
        audio_data: bytes,
        source_language: str,
        target_language: str,
    ) -> TranslationResult:
        """
        フォールバック: 3段階処理（ASR → 翻訳 → TTS）
        """
        try:
            client = await self._get_client()

            # 1. ASR
            original_text = await self.transcribe_audio(audio_data, source_language)
            if not original_text or original_text.startswith("["):
                return TranslationResult(
                    source_language=source_language,
                    target_language=target_language,
                    original_text=original_text or "",
                    translated_text="",
                    audio_data=None,
                )

            # 2. テキスト翻訳
            tgt_name = LANGUAGE_NAMES.get(target_language, target_language)
            translate_model = settings.openai_translate_model

            chat_response = await client.chat.completions.create(
                model=translate_model,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            f"You are a translator. Translate to {tgt_name}. "
                            "Output only the translated text."
                        ),
                    },
                    {"role": "user", "content": original_text},
                ],
                max_tokens=500,
                temperature=0.3,
            )
            translated_text = chat_response.choices[0].message.content
            translated_text = translated_text.strip() if translated_text else ""

            logger.info(
                f"[GPT-Realtime Fallback] 翻訳: '{original_text}' -> '{translated_text}'"
            )

            # 3. TTS
            translated_audio = None
            try:
                tts_response = await client.audio.speech.create(
                    model=settings.openai_tts_model,
                    voice=settings.openai_tts_voice,
                    input=translated_text,
                    response_format="wav",
                )
                translated_audio = tts_response.content
            except Exception as tts_err:
                logger.warning(f"[GPT-Realtime Fallback] TTS失敗: {tts_err}")

            return TranslationResult(
                source_language=source_language,
                target_language=target_language,
                original_text=original_text,
                translated_text=translated_text,
                audio_data=translated_audio,
            )

        except Exception as e:
            logger.error(f"[GPT-Realtime Fallback] エラー: {e}", exc_info=True)
            return TranslationResult(
                source_language=source_language,
                target_language=target_language,
                original_text=f"[エラー: {type(e).__name__}]",
                translated_text=f"[エラー: {type(e).__name__}]",
                audio_data=None,
            )
