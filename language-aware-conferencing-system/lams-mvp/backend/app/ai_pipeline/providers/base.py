"""
AIプロバイダー基底クラスと共通ユーティリティ

すべてのAIプロバイダーはこのモジュールの基底クラスを継承する。
"""

import logging
import re
from abc import ABC, abstractmethod
from dataclasses import dataclass

logger = logging.getLogger(__name__)

# 対応言語マッピング（AIへの指示用）
LANGUAGE_NAMES: dict[str, str] = {
    "ja": "日本語",
    "en": "English",
    "zh": "中文",
    "vi": "Tiếng Việt",
}


@dataclass
class TranslationResult:
    """翻訳結果データクラス"""

    source_language: str
    target_language: str
    original_text: str
    translated_text: str
    audio_data: bytes | None = None  # TTS音声データ（オプション）


class AIProvider(ABC):
    """
    AIプロバイダー基底クラス

    すべてのAIプロバイダーはこのクラスを継承し、
    translate_audio と transcribe_audio メソッドを実装する必要がある。
    """

    # ノイズとして認識されやすいパターン（完全一致用）
    NOISE_PATTERNS_EXACT = [
        "by h",
        "by h.",
        "bye",
        "by.",
        "h.",
        "h",
        "the",
        "a",
        "i",
        "you",
        "uh",
        "um",
        "ah",
        "oh",
        "hmm",
        "hm",
        "mm",
        "mhm",
        # 注: yes/no/ok/okay/yeah/yep/thank(s) は会議の意思表示として正当なため
        # ノイズ除外しない（改善点 M1）。純粋なフィラーのみ残す。
        "so",
        "and",
        "but",
        "or",
        "...",
        "。。。",
        "・・・",
        "…",
        "、",
        "。",
        ".",
        ",",
        "-",
        "—",
        # 「はい」は会議の肯定回答として正当なため除外しない（改善点 M1）。
        "うん",
        "ええ",
        "あー",
        "えー",
        "んー",
        "ん",
        "あ",
        "え",
        "お",
        "嗯",
        "哦",
        "啊",
        # 好的/是的/谢谢/再见 は正当な返答・挨拶として除外しない（改善点 M1）。
    ]

    # メディア系ノイズキーワード（部分一致用）
    MEDIA_NOISE_KEYWORDS = [
        "amara.org",
        "社群提供",
        # 「字幕」は単独では正当語（部分一致で誤除外するため削除。改善点 M1）。
        "订阅",
        "訂閱",
        "点赞",
        "點贊",
        "关注",
        "關注",
        "转发",
        "轉發",
        "打赏",
        "打賞",
        "明镜",
        "明鏡",
        "チャンネル登録",
        "高評価",
        "ご視聴",
        # 「ありがとう」単独は正当な謝意。幻覚句「ご視聴ありがとう…」は "ご視聴" で捕捉する（改善点 M1）。
        "感谢观看",
        "感謝收看",
        "感謝觀看",
        "支持本频道",
        "支持本頻道",
        "欢迎订阅",
        "歡迎訂閱",
        "like and subscribe",
        "subscribe",
        "更多的消息",
        "更多消息",
        "請搜尋",
        "请搜寻",
        "時尚高潮",
        "时尚高潮",
        "本台立場",
        "本台立场",
        "以上言論",
        "以上言论",
        "多謝收看",
        "多谢收看",
        "敬請期待",
        "敬请期待",
        "下期再見",
        "下期再见",
        "記得訂閱",
        "记得订阅",
    ]

    def _is_noise_transcription(self, text: str) -> bool:
        """
        ノイズ認識結果かどうかを判定

        Args:
            text: ASR結果テキスト

        Returns:
            ノイズと判定された場合True
        """
        if not text:
            return True

        # 前後の記号・空白を除去
        text_clean = re.sub(r"^[\s\.\,\!\?\-\—]+|[\s\.\,\!\?\-\—]+$", "", text.lower())
        if not text_clean:
            return True  # 記号・空白のみ

        # CJK（かな/漢字）または数字を含む発話は、短くても意味を持つため除外しない。
        # 例: 「三号」「火曜」「百万」「了解」「はい」「100万円」。会議の短い返答・数値を漏らさないため。
        has_cjk = bool(re.search(r"[぀-ヿ㐀-鿿ｦ-ﾟ]", text))
        has_digit = bool(re.search(r"\d", text))

        # ラテン文字のみ・数字なしで 1 文字以下のみノイズ（"a" 等）。
        # "No"/"OK"/"Yes" 等の意味のある短い返答語は通す。
        if not has_cjk and not has_digit and len(text_clean) <= 1:
            return True

        # 完全一致パターン（非語彙フィラー・幻覚定型句）
        for pattern in self.NOISE_PATTERNS_EXACT:
            if text_clean == pattern.lower().strip():
                return True

        # 同一文字の長い繰り返し（例: 「ああああ」「。。。。」）。
        # 短い正当語（「はい」=2文字種, "OK"）を誤判定しないよう長さ4以上に限定。
        compact = text.replace(" ", "")
        if len(compact) >= 4 and len(set(compact)) <= 2:
            return True

        # メディア系ノイズ（Whisper 幻覚の宣伝句など。部分一致で検出）
        return any(
            keyword.lower() in text_clean for keyword in self.MEDIA_NOISE_KEYWORDS
        )

    @abstractmethod
    async def translate_audio(
        self,
        audio_data: bytes,
        source_language: str,
        target_language: str,
        original_text: str | None = None,
    ) -> TranslationResult:
        """
        音声を翻訳

        Args:
            audio_data: 入力音声データ（WAV形式）
            source_language: 元言語コード（ja, en, zh, vi）
            target_language: 翻訳先言語コード
            original_text: 上流で ASR 済みの原文（あればカスケード実装は
                再 ASR をスキップする。S2S 実装は無視してよい。欠陥 #1）

        Returns:
            翻訳結果（テキスト + 音声）
        """

    @abstractmethod
    async def transcribe_audio(
        self,
        audio_data: bytes,
        language: str,
    ) -> str:
        """
        音声をテキストに変換（ASR）

        Args:
            audio_data: 入力音声データ（WAV形式）
            language: 言語コード

        Returns:
            認識されたテキスト
        """

    async def transcribe_with_detection(
        self,
        audio_data: bytes,
        hint_language: str = "multi",
    ) -> tuple[str, str]:
        """
        音声認識 + 言語検出

        言語自動検出をサポートするプロバイダーはこのメソッドをオーバーライドする。
        デフォルト実装はヒント言語をそのまま使用する。

        Args:
            audio_data: 入力音声データ（WAV形式）
            hint_language: ヒント言語コード（検出のヒント、デフォルトは自動検出）

        Returns:
            (認識テキスト, 検出された言語コード)
        """
        # デフォルト実装: ヒント言語で認識し、同じ言語を返す
        text = await self.transcribe_audio(audio_data, hint_language)
        return text, hint_language


class APIKeyError(Exception):
    """APIキー未設定エラー"""

    pass


def check_api_key(key: str | None, provider_name: str) -> None:
    """
    APIキーの存在を確認

    Args:
        key: APIキー
        provider_name: プロバイダー名（エラーメッセージ用）

    Raises:
        APIKeyError: APIキーが未設定の場合
    """
    if not key:
        raise APIKeyError(
            f"{provider_name} APIキーが設定されていません。"
            ".env ファイルに設定してください。"
        )
