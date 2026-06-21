"""
LAMS LLM 補正（Correction）プロバイダー

目的:
    改善.md 11章「LLM 補正」を実装する。翻訳結果に対し表記統一・文脈補正・
    敬語調整・数字保持を行う校正レイヤを提供する（Mode B / fallback 用）。
入力:
    CorrectionRequest（原文・暫定訳・言語・用語ヒント・文脈）。
出力:
    CorrectionResult（校正後テキスト・変更有無・provider 名）。
注意点:
    - settings.llm_correction_provider="off"（既定）や GEMINI_API_KEY 未設定時は
      registry が None を返し、既存翻訳フローへ一切介入しない（後方互換）。
    - 例外時は呼び出し側で暫定訳へフォールバックする方針（非破壊）。
    - LLM 選択は改善.md 11.2 のポリシー（realtime=GPT / google native=Gemini /
      fallback=Gemini）に従う。本タスクでは Gemini 補正を提供する。
"""

import asyncio
import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass

from app.ai_pipeline.providers.base import check_api_key
from app.config import settings

logger = logging.getLogger(__name__)

# 出力言語名（プロンプト用）。base.LANGUAGE_NAMES は日本語表記のため別途定義する。
_LANGUAGE_NAMES: dict[str, str] = {
    "ja": "Japanese",
    "en": "English",
    "zh": "Chinese",
    "vi": "Vietnamese",
}


@dataclass
class CorrectionRequest:
    """校正リクエスト（原文・暫定訳・言語・用語ヒント・文脈）"""

    source_text: str
    translated_text: str
    source_language: str
    target_language: str
    glossary_hint: str = ""
    context: str = ""


@dataclass
class CorrectionResult:
    """校正結果（校正後テキスト・変更有無・provider 名）"""

    corrected_text: str
    changed: bool
    provider: str


def build_correction_prompt(req: CorrectionRequest) -> str:
    """
    校正用 system プロンプトを生成する（純粋関数）。

    改善.md 11.3 の方針（数字/固有名詞保持・用語集厳守・意味不追加・
    過剰補完禁止・自然な会議表現・target_language のみ出力）に準拠する。
    """
    tgt = _LANGUAGE_NAMES.get(req.target_language, req.target_language)
    parts = [
        "あなたは会議翻訳の校正エンジンです。以下の制約を必ず守ってください。",
        "1. 数字、日付、金額、固有名詞を変更しない。",
        "2. 用語集にある語は必ず指定訳を使う。",
        "3. 意味を追加しない。",
        "4. 不明瞭な発話を推測で補完しすぎない。",
        "5. ビジネス会議として自然な表現に整える。",
        f"6. 出力は {tgt}（{req.target_language}）の訳文のみとし、説明やコメントを付けない。",
    ]
    if req.glossary_hint:
        parts.append(req.glossary_hint)
    if req.context:
        parts.append(req.context)
    return "\n".join(parts)


class LLMCorrectionProvider(ABC):
    """
    LLM 補正プロバイダー抽象（改善.md 11.1 LLMCorrectionProvider 相当）。

    本タスクでは correct_translation のみを定義する。
    summarizeMeeting / extractActions は議事録タスク（Phase 1-T5）で拡張する。
    """

    name: str = "base"

    @abstractmethod
    async def correct_translation(self, req: CorrectionRequest) -> CorrectionResult:
        """暫定訳を校正して返す（実装はプロバイダー毎）"""


class GeminiCorrectionProvider(LLMCorrectionProvider):
    """
    Gemini（google-genai）によるテキスト補正プロバイダー。

    改善.md 11.2 ポリシーの google native / fallback 用補正を担う。
    SDK 呼び出しは同期 API のため asyncio.to_thread でオフロードする。
    テスト容易性のため client を注入可能とする（未注入時は遅延初期化）。
    """

    name = "gemini"

    def __init__(self, client: object | None = None, model: str | None = None) -> None:
        self._client = client
        self._model = model or settings.gemini_text_model
        if client is None:
            check_api_key(settings.gemini_api_key, "Gemini")

    def _ensure_client(self) -> object:
        """google-genai クライアントを遅延初期化する"""
        if self._client is None:
            from google import genai
            from google.genai import types as genai_types

            http_options = None
            base_url = settings.gemini_base_url
            if base_url and base_url != "https://gemini.googleapis.com":
                http_options = genai_types.HttpOptions(base_url=base_url)
            self._client = genai.Client(
                api_key=settings.gemini_api_key, http_options=http_options
            )
            logger.info("[Gemini補正] クライアント初期化")
        return self._client

    async def correct_translation(self, req: CorrectionRequest) -> CorrectionResult:
        original = req.translated_text
        if not original or not original.strip():
            return CorrectionResult(original, changed=False, provider=self.name)

        system_prompt = build_correction_prompt(req)
        contents = (
            f"{system_prompt}\n\n"
            f"[原文] {req.source_text}\n"
            f"[暫定訳] {original}\n"
            "[校正後の訳のみを出力]"
        )
        client = self._ensure_client()
        response = await asyncio.to_thread(
            client.models.generate_content,
            model=self._model,
            contents=contents,
        )
        text = (getattr(response, "text", None) or "").strip()
        if not text:
            return CorrectionResult(original, changed=False, provider=self.name)
        return CorrectionResult(text, changed=(text != original), provider=self.name)


# ============================================================
# Registry（改善.md 11.2 ポリシー / env ゲート）
# ============================================================
_provider_cache: dict[str, LLMCorrectionProvider | None] = {}


def reset_correction_provider() -> None:
    """補正プロバイダーのキャッシュを消去する（設定変更・テスト用）"""
    _provider_cache.clear()


def get_correction_provider() -> LLMCorrectionProvider | None:
    """
    設定に基づき LLM 補正プロバイダーを取得する（無効時は None）。

    - settings.llm_correction_provider="off"（既定）→ None（既存フロー非介入）。
    - "gemini" かつ GEMINI_API_KEY 設定済 → GeminiCorrectionProvider。
    - 鍵未設定 / 初期化失敗時 → None（フォールバック、翻訳は継続）。
    """
    name = settings.llm_correction_provider
    if name == "off":
        return None
    if name == "gemini":
        if not settings.gemini_api_key:
            logger.warning(
                "[LLM補正] gemini 指定だが GEMINI_API_KEY 未設定のため無効化します"
            )
            return None
        if "gemini" not in _provider_cache:
            try:
                _provider_cache["gemini"] = GeminiCorrectionProvider()
            except Exception as e:
                logger.warning(f"[LLM補正] Gemini 初期化失敗のため無効化します: {e}")
                _provider_cache["gemini"] = None
        return _provider_cache["gemini"]
    return None
