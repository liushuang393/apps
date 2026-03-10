"""
LAMS 議事録・要約（Minutes）生成プロバイダー

目的:
    改善.md「会後議事録」を実装する。会議終了後に transcript（発話列）を
    LLM へ渡し、要約・決定事項・ToDo（アクションアイテム）を構造化抽出する。
入力:
    MinutesRequest（結合済み transcript テキスト・出力言語・任意の会議名）。
出力:
    MinutesResult（summary・decisions・action_items・provider 名）。
注意点:
    - 改善.md 11.2 のポリシーに従い GPT 優先 / Gemini fallback とする
      （settings.llm_minutes_provider で固定・無効化も可能）。
    - オンデマンド生成（コスト意識）。鍵未設定時は registry が None を返し、
      呼び出し側（API）は 503 を返して既存フローへ介入しない。
    - LLM 出力は JSON を要求し、parse_minutes_response で堅牢に解析する
      （コードフェンス除去・キー欠落許容）。Mode A/B のパイプラインとは独立。
"""

import asyncio
import json
import logging
import re
from abc import ABC, abstractmethod
from dataclasses import dataclass, field

from app.ai_pipeline.providers.base import check_api_key
from app.config import settings

logger = logging.getLogger(__name__)

# 出力言語名（プロンプト用）。会議の議事録は出力言語を明示して指示する。
_LANGUAGE_NAMES: dict[str, str] = {
    "ja": "Japanese",
    "en": "English",
    "zh": "Chinese",
    "vi": "Vietnamese",
}

# LLM 生成パラメータ（マジックナンバー回避のため定数化）
_MINUTES_MAX_TOKENS = 1500
_MINUTES_TEMPERATURE = 0.2


@dataclass
class MinutesRequest:
    """議事録生成リクエスト（結合済み transcript・出力言語・会議名）"""

    transcript: str
    output_language: str = "ja"
    meeting_title: str = ""


@dataclass
class MinutesResult:
    """議事録生成結果（要約・決定事項・ToDo・provider 名）"""

    summary: str
    decisions: list[str] = field(default_factory=list)
    action_items: list[str] = field(default_factory=list)
    provider: str = "base"


def build_minutes_prompt(req: MinutesRequest) -> str:
    """
    議事録生成用プロンプトを生成する（純粋関数）。

    LLM へ JSON 出力（summary / decisions / action_items）を厳密に要求し、
    出力言語・事実厳守（推測の決定/ToDo を捏造しない）を指示する。
    """
    lang = _LANGUAGE_NAMES.get(req.output_language, req.output_language)
    parts = [
        "あなたは多言語会議の議事録作成アシスタントです。",
        "与えられた会議の発言記録（transcript）から議事録を作成してください。",
        "以下の制約を必ず守ってください。",
        "1. 事実のみを用い、記録にない決定事項やToDoを捏造しない。",
        "2. 数字・日付・金額・固有名詞を変更しない。",
        f"3. すべての出力は {lang}（{req.output_language}）で記述する。",
        "4. 出力は次の JSON のみとし、説明やコードフェンスを付けない。",
        '   {"summary": string, "decisions": [string], "action_items": [string]}',
        "5. summary は要点を簡潔にまとめた文章。",
        "6. decisions は会議で確定した決定事項の箇条書き（無ければ空配列）。",
        "7. action_items は担当者・期限が分かれば含めたToDoの箇条書き（無ければ空配列）。",
    ]
    if req.meeting_title:
        parts.append(f"会議名: {req.meeting_title}")
    return "\n".join(parts)


def parse_minutes_response(text: str, provider: str) -> MinutesResult:
    """
    LLM の応答テキストを MinutesResult へ堅牢に解析する（純粋関数）。

    - ```json ... ``` 等のコードフェンスを除去してから JSON 解析する。
    - キー欠落・型不一致は安全側（空文字 / 空配列）にフォールバックする。
    - JSON 解析に失敗した場合は応答全文を summary に格納する（非破壊）。
    """
    raw = (text or "").strip()
    if not raw:
        return MinutesResult(summary="", provider=provider)

    # コードフェンス（```json / ```）を除去する
    fenced = re.match(r"^```[a-zA-Z]*\s*(.*?)\s*```$", raw, re.DOTALL)
    if fenced:
        raw = fenced.group(1).strip()

    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, ValueError):
        return MinutesResult(summary=raw, provider=provider)

    if not isinstance(data, dict):
        return MinutesResult(summary=raw, provider=provider)

    summary = data.get("summary")
    summary = summary.strip() if isinstance(summary, str) else ""

    def _as_str_list(value: object) -> list[str]:
        if not isinstance(value, list):
            return []
        return [str(item).strip() for item in value if str(item).strip()]

    return MinutesResult(
        summary=summary,
        decisions=_as_str_list(data.get("decisions")),
        action_items=_as_str_list(data.get("action_items")),
        provider=provider,
    )


class MinutesProvider(ABC):
    """議事録生成プロバイダー抽象（GPT / Gemini 実装の共通インターフェース）"""

    name: str = "base"

    @abstractmethod
    async def generate_minutes(self, req: MinutesRequest) -> MinutesResult:
        """transcript から議事録（要約・決定事項・ToDo）を生成して返す"""


def _empty_or_minutes(req: MinutesRequest, provider: str) -> MinutesResult | None:
    """transcript が空なら空の議事録を返し、それ以外は None（生成続行）"""
    if not req.transcript or not req.transcript.strip():
        return MinutesResult(summary="", provider=provider)
    return None


class GptMinutesProvider(MinutesProvider):
    """
    OpenAI Chat Completions による議事録生成プロバイダー（GPT 優先）。

    JSON 出力モード（response_format）を用い、parse_minutes_response で解析する。
    テスト容易性のため client を注入可能とする（未注入時は遅延初期化）。
    """

    name = "gpt"

    def __init__(self, client: object | None = None, model: str | None = None) -> None:
        self._client = client
        self._model = model or settings.openai_minutes_model
        if client is None:
            check_api_key(settings.openai_api_key, "OpenAI")

    async def _ensure_client(self) -> object:
        """AsyncOpenAI クライアントを遅延初期化する"""
        if self._client is None:
            from openai import AsyncOpenAI

            base_url = settings.openai_base_url or "https://api.openai.com/v1"
            self._client = AsyncOpenAI(
                api_key=settings.openai_api_key, base_url=base_url
            )
            logger.info(f"[議事録/GPT] クライアント初期化: {base_url}")
        return self._client

    async def generate_minutes(self, req: MinutesRequest) -> MinutesResult:
        empty = _empty_or_minutes(req, self.name)
        if empty is not None:
            return empty

        system_prompt = build_minutes_prompt(req)
        client = await self._ensure_client()
        response = await client.chat.completions.create(
            model=self._model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": req.transcript},
            ],
            max_tokens=_MINUTES_MAX_TOKENS,
            temperature=_MINUTES_TEMPERATURE,
            response_format={"type": "json_object"},
        )
        text = response.choices[0].message.content or ""
        return parse_minutes_response(text, self.name)


class GeminiMinutesProvider(MinutesProvider):
    """
    Gemini（google-genai）による議事録生成プロバイダー（GPT 不可時の fallback）。

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
            logger.info("[議事録/Gemini] クライアント初期化")
        return self._client

    async def generate_minutes(self, req: MinutesRequest) -> MinutesResult:
        empty = _empty_or_minutes(req, self.name)
        if empty is not None:
            return empty

        system_prompt = build_minutes_prompt(req)
        contents = f"{system_prompt}\n\n[発言記録]\n{req.transcript}\n\n[JSONのみ出力]"
        client = self._ensure_client()
        response = await asyncio.to_thread(
            client.models.generate_content,
            model=self._model,
            contents=contents,
        )
        text = getattr(response, "text", None) or ""
        return parse_minutes_response(text, self.name)


# ============================================================
# Registry（GPT 優先 / Gemini fallback。env ゲート）
# ============================================================
_provider_cache: dict[str, MinutesProvider | None] = {}


def reset_minutes_provider() -> None:
    """議事録プロバイダーのキャッシュを消去する（設定変更・テスト用）"""
    _provider_cache.clear()


def _build_gpt() -> MinutesProvider | None:
    """OPENAI_API_KEY があれば GptMinutesProvider を構築する（失敗時 None）"""
    if not settings.openai_api_key:
        return None
    try:
        return GptMinutesProvider()
    except Exception as e:
        logger.warning(f"[議事録] GPT 初期化失敗: {e}")
        return None


def _build_gemini() -> MinutesProvider | None:
    """GEMINI_API_KEY があれば GeminiMinutesProvider を構築する（失敗時 None）"""
    if not settings.gemini_api_key:
        return None
    try:
        return GeminiMinutesProvider()
    except Exception as e:
        logger.warning(f"[議事録] Gemini 初期化失敗: {e}")
        return None


def get_minutes_provider() -> MinutesProvider | None:
    """
    設定に基づき議事録生成プロバイダーを取得する（無効・鍵未設定時は None）。

    - "off"   : None（議事録 API は 503 を返す）。
    - "gpt"   : GptMinutesProvider（鍵未設定なら None）。
    - "gemini": GeminiMinutesProvider（鍵未設定なら None）。
    - "auto"  : GPT 優先、鍵が無ければ Gemini へ fallback、どちらも無ければ None。
    """
    policy = settings.llm_minutes_provider
    if policy == "off":
        return None
    if policy in _provider_cache:
        return _provider_cache[policy]

    if policy == "gpt":
        provider = _build_gpt()
    elif policy == "gemini":
        provider = _build_gemini()
    else:  # auto
        provider = _build_gpt() or _build_gemini()
        if provider is None:
            logger.warning("[議事録] LLM 鍵未設定のため議事録生成を無効化します")

    _provider_cache[policy] = provider
    return provider
