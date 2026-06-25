"""mode2（gpt4o_transcribe）の翻訳が、用語集・文脈・補正込みの共通MT経路
(translate_text_simple) を通ることを保証する回帰テスト。

改善点 Q1（docs/翻訳品質_改善点.md）: 従来 translate_audio は素のプロンプトで翻訳しており
用語集/文脈/補正が一切効かなかった。共通MT経路へ一本化したことを検証する。
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.ai_pipeline.providers.gpt4o_transcribe import GPT4oTranscribeProvider


@pytest.mark.asyncio
async def test_translate_audio_uses_shared_quality_mt_path():
    provider = GPT4oTranscribeProvider()

    # ASR は固定テキストを返す（実APIを呼ばない）
    provider.transcribe_audio = AsyncMock(return_value="では会議を始めます")

    # TTS 用クライアントをモック（audio.speech.create が音声バイトを返す）
    mock_client = MagicMock()
    mock_client.audio.speech.create = AsyncMock(return_value=MagicMock(content=b"WAVDATA"))
    provider._get_client = AsyncMock(return_value=mock_client)

    # 共通MT経路をスパイ（用語集/文脈/補正を内包する関数）
    with patch(
        "app.translate.routes.translate_text_simple",
        new=AsyncMock(return_value="Let's start the meeting"),
    ) as mt:
        result = await provider.translate_audio(b"dummy-audio", "ja", "en")

    # 共通MT経路が ASR テキストで呼ばれていること（= 用語集等が効く経路）
    mt.assert_awaited_once_with("では会議を始めます", "ja", "en")
    assert result.translated_text == "Let's start the meeting"
    assert result.original_text == "では会議を始めます"
