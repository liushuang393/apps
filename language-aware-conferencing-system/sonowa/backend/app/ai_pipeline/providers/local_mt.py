"""
Lite 本地 MT ステージ（MADLAD-400 単一多言語 + CTranslate2 int8）

目的:
    言語対別 OPUS-MT を廃止し、1 モデルで ja/en/zh/vi を相互翻訳する。
    既存 OpenAIMTStage / GoogleMTStage と同じステージ契約（name / translate_text /
    空文字契約）を満たす。
入力 / 出力:
    registry.py の MT ステージ Protocol に準拠する（translate_text）。
注意点:
    - ctranslate2 / transformers は遅延 import（未導入環境でもモジュール import 可）。
    - settings.local_mt_model_dir は CT2 変換済み MADLAD ディレクトリを指す。
    - ターゲット言語は入力先頭の <2xx> タグで指定する（MADLAD 慣習）。
    - 失敗・VRAM 逼迫は "" を返し、字幕経路の継続を可能にする。
"""

import asyncio
import logging
import os
from dataclasses import dataclass

from app.ai_pipeline.vram_broker import (
    PRIORITY_MT,
    VRAMCapacityError,
)
from app.ai_pipeline.vram_broker import (
    broker as default_broker,
)
from app.config import settings

logger = logging.getLogger(__name__)

# 単一エンジンの VRAM Broker キー（言語対ごとに分割しない）。
ENGINE_CACHE_KEY = "mt:madlad400"

# Sonowa 対応言語 → MADLAD ターゲットタグ。
SUPPORTED_TARGET_TAGS: dict[str, str] = {
    "ja": "<2ja>",
    "en": "<2en>",
    "zh": "<2zh>",
    "vi": "<2vi>",
}


def target_tag(language: str) -> str:
    """言語コードから MADLAD の <2xx> タグを返す。"""
    return SUPPORTED_TARGET_TAGS.get(language, f"<2{language}>")


def available() -> bool:
    """本地 MT が利用可能かを返す。

    ctranslate2 が import 可能、かつ settings.local_mt_model_dir が存在するときのみ True。
    """
    model_dir = settings.local_mt_model_dir
    if not model_dir or not os.path.isdir(model_dir):
        return False
    try:
        import importlib.util

        return importlib.util.find_spec("ctranslate2") is not None
    except (ImportError, ValueError):
        return False


@dataclass
class _Engine:
    """常駐エンジン（translator + tokenizer）を束ねる会計単位。"""

    translator: object
    tokenizer: object


class LocalMTStage:
    """MADLAD-400 + CTranslate2 による単一多言語テキスト翻訳（MT）ステージ。"""

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
        """テキストを翻訳する。失敗は "" を返す（雲へ縮退可能に）。"""
        if not text or not text.strip():
            return ""
        if source_language == target_language:
            return text
        if target_language not in SUPPORTED_TARGET_TAGS:
            logger.warning("[MT:local] 未対応ターゲット言語: %s", target_language)
            return ""
        try:
            # テスト注入時はブローカーを経由せず直接実行する。
            if self._translator is not None and self._tokenizer is not None:
                engine = _Engine(translator=self._translator, tokenizer=self._tokenizer)
                return await asyncio.to_thread(
                    self._run_translate, engine, text, target_language
                )
            return await self._translate_via_broker(text, target_language)
        except VRAMCapacityError as e:
            logger.warning("[MT:local] VRAM 逼迫のため縮退: %s", e)
            return ""
        except Exception as e:  # noqa: BLE001 - 失敗は "" で雲へ縮退させる契約
            logger.warning("[MT:local] 翻訳失敗: %s", e)
            return ""

    async def _translate_via_broker(self, text: str, target_language: str) -> str:
        """VRAM Broker 経由で単一エンジンを常駐させ翻訳する。"""
        broker = self._broker or default_broker
        async with broker.use(
            key=ENGINE_CACHE_KEY,
            loader=self._load_engine,
            size_mb=settings.local_mt_size_mb,
            priority=PRIORITY_MT,
            version=settings.local_mt_model_id,
        ) as engine:
            return await asyncio.to_thread(
                self._run_translate, engine, text, target_language
            )

    def _load_engine(self) -> _Engine:
        """MADLAD CT2 モデルとトークナイザをロードする（Broker loader）。"""
        if self._translator is not None and self._tokenizer is not None:
            return _Engine(translator=self._translator, tokenizer=self._tokenizer)

        model_dir = settings.local_mt_model_dir
        if not model_dir:
            raise RuntimeError("local_mt_model_dir 未設定のため本地 MT は利用不可")
        if not os.path.isdir(model_dir):
            raise RuntimeError(f"モデルディレクトリが存在しない: {model_dir}")

        import ctranslate2  # noqa: PLC0415

        translator = ctranslate2.Translator(
            model_dir,
            device=settings.local_mt_device,
            compute_type=settings.local_mt_compute_type,
        )
        tokenizer = self._load_tokenizer()
        return _Engine(translator=translator, tokenizer=tokenizer)

    @staticmethod
    def _load_tokenizer() -> object:
        """MADLAD 用トークナイザをロードする（遅延 import）。"""
        from transformers import AutoTokenizer  # noqa: PLC0415

        return AutoTokenizer.from_pretrained(settings.local_mt_tokenizer_id)

    @staticmethod
    def _run_translate(engine: _Engine, text: str, target_language: str) -> str:
        """ブロッキング翻訳本体（to_thread から呼ばれる）。"""
        tokenizer = engine.tokenizer
        translator = engine.translator
        tagged = f"{target_tag(target_language)}{text}"
        # MADLAD + CT2 慣習: encode → convert_ids_to_tokens → translate_batch → decode
        input_ids = tokenizer.encode(tagged)
        input_tokens = tokenizer.convert_ids_to_tokens(input_ids)
        results = translator.translate_batch([input_tokens])
        hypothesis = results[0].hypotheses[0]
        output_ids = tokenizer.convert_tokens_to_ids(hypothesis)
        out = tokenizer.decode(output_ids, skip_special_tokens=True)
        return out.strip() if out else ""
