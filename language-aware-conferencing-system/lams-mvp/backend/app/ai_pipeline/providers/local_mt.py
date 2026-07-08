"""
Lite 本地 MT ステージ（OPUS-MT / Marian + CTranslate2 int8）

目的:
    改善案 §6.1「Lite（本地）主線」の MT スロット実体。雲 API に依存せず、
    OPUS-MT（言語対別 Marian モデルを CTranslate2 で int8 量子化したもの）を
    CPU/GPU 上で走らせて低コスト翻訳を提供する。既存 OpenAIMTStage / GoogleMTStage
    と同じステージ契約（name / translate_text / 空文字契約）を満たす。
入力 / 出力:
    registry.py の MT ステージ Protocol に準拠する（translate_text）。
注意点:
    - ctranslate2 / transformers / sentencepiece は GPU・環境依存が重いため、
      本モジュール先頭では絶対に import しない（遅延 import）。パッケージ未導入でも
      `import app.ai_pipeline.providers.local_mt` が成功し単体テスト可能であること。
    - OPUS-MT は言語対別モデル。ディレクトリ名を `opus-mt-{src}-{tgt}` とし、
      settings.local_mt_model_dir 直下から解決する。model_dir 未設定なら利用不可。
    - 実モデルの常駐調停は VRAM Broker に委譲する（loader を注入）。
    - 失敗（例外・VRAM 逼迫）は logger.warning のうえ "" を返す（＝当該訳の欠落。
      registry の雲 fallback は構築時のみで、ランタイムの空結果は再試行しない）。
    - translator / tokenizer は注入可能（テスト用）。注入があれば実ロードを行わない。
"""

import asyncio
import logging
import os
from dataclasses import dataclass

from app.ai_pipeline.providers.base import LANGUAGE_NAMES
from app.ai_pipeline.vram_broker import (
    PRIORITY_MT,
    VRAMCapacityError,
)
from app.ai_pipeline.vram_broker import (
    broker as default_broker,
)
from app.config import settings

logger = logging.getLogger(__name__)


def available() -> bool:
    """本地 MT が利用可能かを返す（この環境では False）。

    ctranslate2 が import 可能、かつ settings.local_mt_model_dir が設定済みの
    ときのみ True。GPU / ctranslate2 未導入や model_dir 未設定では False。
    """
    if not settings.local_mt_model_dir:
        return False
    try:
        import importlib.util

        return importlib.util.find_spec("ctranslate2") is not None
    except (ImportError, ValueError):  # find_spec は稀に ValueError を投げ得る
        return False


def _pair_dir_name(source_language: str, target_language: str) -> str:
    """言語対からモデルディレクトリ名を導出する（例: opus-mt-ja-en）。"""
    return f"opus-mt-{source_language}-{target_language}"


@dataclass
class _Engine:
    """常駐エンジン（translator + tokenizer）を束ねる会計単位。"""

    translator: object
    tokenizer: object


class LocalMTStage:
    """OPUS-MT + CTranslate2 によるテキスト翻訳（MT）ステージ。"""

    name = "local"

    def __init__(
        self,
        translator: object | None = None,
        tokenizer: object | None = None,
        broker: object | None = None,
    ) -> None:
        """依存を注入可能にする（テスト用）。

        Args:
            translator: 注入 translator（あれば実ロードをスキップ）。
            tokenizer: 注入 tokenizer（あれば実ロードをスキップ）。
            broker: 注入 VRAM Broker（未指定はモジュール既定を共有）。
        """
        self._translator = translator
        self._tokenizer = tokenizer
        self._broker = broker

    async def translate_text(
        self, text: str, source_language: str, target_language: str
    ) -> str:
        """テキストを翻訳する。失敗は "" を返す（雲へ縮退可能に）。

        - 空 / 空白のみ入力は "" を返す。
        - source == target は原文をそのまま返す（無駄なロードを避ける）。
        - 例外・VRAM 逼迫時は logger.warning のうえ "" を返す。
        """
        if not text or not text.strip():
            return ""
        if source_language == target_language:
            return text
        try:
            return await self._translate_via_broker(
                text, source_language, target_language
            )
        except VRAMCapacityError as e:
            logger.warning("[MT:local] VRAM 逼迫のため縮退: %s", e)
            return ""
        except Exception as e:  # noqa: BLE001 - 失敗は "" で雲へ縮退させる契約
            logger.warning("[MT:local] 翻訳失敗: %s", e)
            return ""

    async def _translate_via_broker(
        self, text: str, source_language: str, target_language: str
    ) -> str:
        """VRAM Broker 経由でエンジンを常駐させ翻訳を実行する。"""
        dir_name = _pair_dir_name(source_language, target_language)
        broker = self._broker or default_broker
        async with broker.use(
            key=f"mt:{source_language}-{target_language}",
            loader=lambda: self._load_pair(source_language, target_language),
            size_mb=settings.local_mt_size_mb,
            priority=PRIORITY_MT,
            version=dir_name,
        ) as engine:
            # 実翻訳はブロッキングのため別スレッドで実行する。
            return await asyncio.to_thread(self._run_translate, engine, text)

    def _load_pair(self, source_language: str, target_language: str) -> _Engine:
        """言語対モデルをロードする（Broker の loader。遅延 import）。

        注入があればそれを使う。無ければ ctranslate2 / transformers を遅延 import して
        実ロードする（この環境ではパッケージ未導入のため実行されない）。
        """
        if self._translator is not None and self._tokenizer is not None:
            return _Engine(translator=self._translator, tokenizer=self._tokenizer)

        model_dir = settings.local_mt_model_dir
        if not model_dir:
            raise RuntimeError("local_mt_model_dir 未設定のため本地 MT は利用不可")
        path = os.path.join(model_dir, _pair_dir_name(source_language, target_language))
        if not os.path.isdir(path):
            raise RuntimeError(f"モデルディレクトリが存在しない: {path}")

        # 遅延 import（先頭 import 禁止）。GPU / ネイティブ依存を隔離する。
        import ctranslate2  # noqa: PLC0415

        translator = self._translator or ctranslate2.Translator(
            path,
            device=settings.local_mt_device,
            compute_type=settings.local_mt_compute_type,
        )
        tokenizer = self._tokenizer or self._load_tokenizer(path)
        return _Engine(translator=translator, tokenizer=tokenizer)

    @staticmethod
    def _load_tokenizer(path: str) -> object:
        """OPUS-MT 用トークナイザをロードする（遅延 import）。

        TODO(v2): OPUS-MT は sentencepiece ベース。transformers の AutoTokenizer で
        Marian トークナイザをロードするか、sentencepiece の SentencePieceProcessor を
        直接使う。v1 は骨格のみで、実運用トークナイズ（サブワード化 / detokenize）は
        ここに集約する。
        """
        from transformers import AutoTokenizer  # noqa: PLC0415

        return AutoTokenizer.from_pretrained(path)

    @staticmethod
    def _run_translate(engine: _Engine, text: str) -> str:
        """ブロッキング翻訳本体（to_thread から呼ばれる）。

        tokenizer でサブワードへ分割 → CTranslate2 で翻訳 → detokenize する。
        注入フェイクは tokenize/detokenize と translate_batch を備える前提。
        """
        tokenizer = engine.tokenizer
        translator = engine.translator
        # サブワード列へ分割（transformers/sentencepiece 互換の tokenize を想定）。
        tokens = tokenizer.tokenize(text)
        results = translator.translate_batch([tokens])
        # CTranslate2 の戻りは results[i].hypotheses[0] にトークン列が入る。
        hypothesis = results[0].hypotheses[0]
        # サブワード列を文字列へ復元（convert_tokens_to_string を想定）。
        out = tokenizer.convert_tokens_to_string(hypothesis)
        return out.strip() if out else ""


def language_name(code: str) -> str:
    """言語コードを表示名へ変換する（診断ログ用の補助）。"""
    return LANGUAGE_NAMES.get(code, code)
