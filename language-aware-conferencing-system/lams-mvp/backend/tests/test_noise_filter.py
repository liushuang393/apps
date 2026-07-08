"""ノイズフィルタ（_is_noise_transcription）の回帰テスト。

会議の正当な発話（短い返答語・CJK短語・数字）を**漏らさない**こと、
かつ非語彙フィラーと Whisper 幻覚句は**除外**することを保証する。
（改善点 M1: docs/翻訳品質_改善点.md）
"""

from app.ai_pipeline.providers.base import AIProvider, TranslationResult


class _DummyProvider(AIProvider):
    """_is_noise_transcription だけ検証するための最小実装。"""

    async def translate_audio(
        self, audio_data: bytes, source_language: str, target_language: str
    ) -> TranslationResult:  # pragma: no cover - 本テストでは未使用
        raise NotImplementedError

    async def transcribe_audio(self, audio_data: bytes, language: str) -> str:  # pragma: no cover
        raise NotImplementedError


_P = _DummyProvider()


# 会議で正当に使われ、翻訳すべき発話 → ノイズ扱いしてはならない（②漏れ防止）
LEGIT = [
    "はい",
    "いいえ",
    "No",
    "OK",
    "Yes",
    "好的",
    "是的",
    "三号",
    "火曜",
    "百万",
    "了解",
    "賛成",
    "100万円",
    "3号室です",
    "ありがとうございます",
]

# 非語彙フィラー / Whisper 幻覚句 → ノイズとして除外してよい
NOISE = [
    "",
    "uh",
    "um",
    "ah",
    "hmm",
    "...",
    "。。。",
    "…",
    "あー",
    "えー",
    "嗯",
    "a",
    "ご視聴ありがとうございました",
    "please subscribe",
    "チャンネル登録",
    "amara.org",
]


def test_legit_utterances_are_not_noise():
    for text in LEGIT:
        assert _P._is_noise_transcription(text) is False, f"正当な発話を誤除外: {text!r}"


def test_filler_and_hallucination_are_noise():
    for text in NOISE:
        assert _P._is_noise_transcription(text) is True, f"ノイズを通過させた: {text!r}"
