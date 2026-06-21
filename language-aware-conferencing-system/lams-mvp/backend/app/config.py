"""
LAMS 設定モジュール
アプリケーション全体の設定を管理する

API Key優先順位: 環境変数 > .env > secrets.json
すべての設定は環境変数から読み込み、ハードコードは禁止。
"""

import json
import logging
import os
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings

logger = logging.getLogger(__name__)


def _load_secrets_json() -> dict:
    """
    secrets.json からシークレット情報を読み込む

    検索パス:
    1. 環境変数 SECRETS_JSON_PATH で指定されたパス
    2. カレントディレクトリの secrets.json
    3. backend/ ディレクトリの secrets.json
    4. プロジェクトルートの secrets.json

    Returns:
        dict: シークレット情報（見つからない場合は空辞書）
    """
    # 検索パスのリスト
    search_paths = [
        os.environ.get("SECRETS_JSON_PATH"),
        Path.cwd() / "secrets.json",
        Path(__file__).parent.parent.parent / "secrets.json",  # backend/
        Path(__file__).parent.parent.parent.parent / "secrets.json",  # project root
    ]

    for path in search_paths:
        if path is None:
            continue
        path = Path(path)
        if path.exists() and path.is_file():
            try:
                with open(path, encoding="utf-8") as f:
                    data = json.load(f)
                    logger.info("secrets.json を読み込みました: %s", path)
                    return data
            except (json.JSONDecodeError, OSError) as e:
                logger.warning("secrets.json 読み込みエラー (%s): %s", path, e)

    return {}


# secrets.json を先に読み込む（Settings初期化前に必要）
_secrets = _load_secrets_json()


def _get_secret(key: str, default: str | None = None) -> str | None:
    """
    シークレット値を取得（優先順位: 環境変数 > .env > secrets.json）

    Args:
        key: シークレットのキー名
        default: デフォルト値

    Returns:
        シークレット値（見つからない場合はデフォルト値）
    """
    # 環境変数が最優先（.envも含む、pydantic-settingsが処理）
    env_value = os.environ.get(key.upper())
    if env_value:
        return env_value

    # secrets.json から取得
    secrets_value = _secrets.get(key) or _secrets.get(key.lower())
    if secrets_value:
        return secrets_value

    return default


class Settings(BaseSettings):
    """
    アプリケーション設定クラス

    API Key優先順位: 環境変数 > .env
    デフォルト値は開発環境用。本番環境では必ず環境変数で上書きすること。
    """

    # ===========================================
    # データベース設定
    # ローカル開発時はDocker DB（host.docker.internal:5433）を使用
    # ===========================================
    database_url: str = (
        "postgresql://lams:lams_secret_2024@host.docker.internal:5433/lams"
    )

    # ===========================================
    # Redis設定
    # ローカル開発時はDocker Redis（host.docker.internal:6380）を使用
    # ===========================================
    redis_url: str = "redis://host.docker.internal:6380/0"

    # ===========================================
    # JWT認証設定
    # ===========================================
    jwt_secret: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 1440  # 24時間

    # ===========================================
    # AIプロバイダー設定
    # ===========================================
    # プロバイダー選択: gpt4o_transcribe, gpt_realtime, deepgram, google, gemini_live
    #   google = Mode B（Chirp 3 ASR + Cloud Translation）。認証/ライブラリ未整備時は
    #            起動エラーにせず gpt4o_transcribe へ自動フォールバックする。
    #   gemini_live = Gemini Live API による S2S 翻訳（音声直接翻訳）。GEMINI_API_KEY
    #            未設定時は起動エラーにせず gpt4o_transcribe へ自動フォールバックする。
    ai_provider: Literal[
        "gpt4o_transcribe", "gpt_realtime", "deepgram", "google", "gemini_live"
    ] = "gpt4o_transcribe"

    # -------------------------------------------
    # ステージ別プロバイダースロット（Phase 2-T5.5 / 集中管理）
    # -------------------------------------------
    # ASR / MT / TTS を独立に切替可能にするスロット。registry.py のカタログ名を指定。
    # "auto"（既定）の場合は ai_provider プリセットから既定名を導出し、3スロットとも
    # "auto" なら従来の一体型 provider をそのまま使う（完全な後方互換・非介入）。
    # いずれか1つでも非 "auto" を指定すると CompositeAIProvider が有効化される。
    #   - asr_provider: auto / gpt4o / deepgram / google
    #   - mt_provider : auto / openai / google
    #   - tts_provider: auto / openai / none
    asr_provider: Literal["auto", "gpt4o", "deepgram", "google"] = "auto"
    mt_provider: Literal["auto", "openai", "google"] = "auto"
    tts_provider: Literal["auto", "openai", "none"] = "auto"

    # -------------------------------------------
    # OpenAI API 設定（gpt4o_transcribe, gpt_realtime共通）
    # -------------------------------------------
    openai_api_key: str | None = None
    openai_base_url: str | None = None  # カスタムエンドポイント（オプション）

    # GPT-4o-transcribe 設定（ASR用、300-500ms）
    # 最新モデル: gpt-4o-transcribe, gpt-4o-mini-transcribe
    openai_transcribe_model: str = "gpt-4o-transcribe"

    # GPT-Realtime S2S 設定（音声直接翻訳、WebSocket API）
    # 最新モデル: gpt-realtime-1.5（推奨）, gpt-realtime, gpt-realtime-mini
    # gpt-realtime-1.5: +7%命令追従、+10%英数字精度、多言語対応向上
    openai_realtime_model: str = "gpt-realtime-1.5"

    # テキスト翻訳用モデル
    openai_translate_model: str = "gpt-4o-mini"

    # 議事録・要約生成用モデル（Phase 1-T5。長文要約のため translate と分離）
    openai_minutes_model: str = "gpt-4o-mini"

    # TTS用モデルと音声
    openai_tts_model: str = "tts-1"
    openai_tts_voice: str = "alloy"

    # -------------------------------------------
    # 言語検出設定
    # -------------------------------------------
    # 言語検出モード:
    #   - auto: 自動検出（Whisper/GPT-4oで言語を検出）
    #   - hint: 話者のnative_languageをヒントとして使用（検出なし）
    language_detection_mode: Literal["auto", "hint"] = "auto"

    # -------------------------------------------
    # Deepgram API 設定（ASR用、200-400ms）
    # -------------------------------------------
    deepgram_api_key: str | None = None
    deepgram_base_url: str | None = None  # カスタムエンドポイント（オプション）
    # Nova-3は最新の高精度・低遅延モデル
    deepgram_model: str = "nova-3"
    # ストリーミングASR用設定
    deepgram_language: str = "multi"  # multi = 多言語自動検出

    # -------------------------------------------
    # Gemini API 設定（将来の拡張用、現在未使用）
    # -------------------------------------------
    gemini_api_key: str | None = None
    gemini_base_url: str | None = None
    gemini_model: str = "models/gemini-2.5-flash-native-audio-preview-12-2025"
    gemini_text_model: str = "models/gemini-2.5-flash"

    # Gemini Live API S2S 翻訳モデル（ai_provider="gemini_live" 時に使用）
    # 音声入力（16kHz PCM）→ 翻訳音声（24kHz PCM）+ 翻訳/原文字幕を同時取得。
    gemini_live_model: str = "models/gemini-3.5-live-translate-preview"

    # -------------------------------------------
    # LLM 補正設定（改善.md 11章 / Mode B・fallback 用）
    # -------------------------------------------
    # 翻訳結果の校正（表記統一・文脈補正・数字保持）に使う LLM プロバイダー。
    #   - off   : 補正を行わない（既定。既存翻訳フローへ非介入）
    #   - gemini: Gemini で校正（GEMINI_API_KEY 必須。未設定時は自動で無効化）
    llm_correction_provider: Literal["off", "gemini"] = "off"

    # 議事録・要約（Phase 1-T5）生成に使う LLM プロバイダー選択ポリシー。
    #   - auto  : GPT 優先（OPENAI_API_KEY あれば GPT、無ければ Gemini へ fallback）
    #   - gpt   : GPT 固定（OPENAI_API_KEY 必須）
    #   - gemini: Gemini 固定（GEMINI_API_KEY 必須）
    #   - off   : 議事録生成を無効化（API は 503 を返す）
    llm_minutes_provider: Literal["auto", "gpt", "gemini", "off"] = "auto"

    # -------------------------------------------
    # Google Cloud 設定（改善.md Mode B：Chirp 3 ASR + Cloud Translation）
    # -------------------------------------------
    # 認証は GOOGLE_APPLICATION_CREDENTIALS（サービスアカウント JSON パス）または
    # ADC を使用。GOOGLE_PROJECT_ID 未設定時は google プロバイダーは無効扱い。
    google_project_id: str | None = None
    # Chirp 3 は Speech-to-Text V2 の地域エンドポイントが必要（既定: us-central1）
    google_speech_location: str = "us-central1"
    google_speech_model: str = "chirp_3"
    # Cloud Translation v3 のロケーション（用語集利用時は global 以外が必要な場合あり）
    google_translate_location: str = "global"
    # サーバー側用語集リソース ID（任意。adaptive/glossary 連携用）
    google_glossary_id: str | None = None

    # -------------------------------------------
    # LiveKit / WebRTC 設定（Phase 3 C1：単一トランスポート）
    # -------------------------------------------
    # WS を廃止し WebRTC/LiveKit へ一本化する。バックエンドは（1）参加トークン発行と
    # （2）LiveKit Agent（音声フォーク Gateway）でのみ LiveKit と通信する。
    #   - livekit_url       : サーバ→LiveKit の接続先（ws://livekit:7880 等）。
    #   - livekit_ws_url    : フロントへ返す公開 URL（未設定時は livekit_url を流用）。
    #   - livekit_api_key   : API キー（トークン署名・Room API 用）。
    #   - livekit_api_secret: API シークレット（トークン署名用）。
    #   - livekit_agent_name: Agent dispatch 名（任意。明示 dispatch 時のみ使用）。
    #   - livekit_agent_autostart: トークン発行時にバックエンド内で Agent を
    #       自動起動するか（True で in-process worker を room 毎に常駐させる）。
    #       既定 False（外部 worker 運用やテスト時の副作用回避のため）。
    # いずれかが未設定なら token API は 503 を返す（起動は阻害しない）。
    livekit_url: str = "ws://localhost:7880"
    livekit_ws_url: str | None = None
    livekit_api_key: str | None = None
    livekit_api_secret: str | None = None
    livekit_agent_name: str | None = None
    livekit_agent_autostart: bool = False

    def get_livekit_ws_url(self) -> str:
        """フロントへ返す LiveKit 接続 URL（公開 URL 優先、無ければ内部 URL）。"""
        return self.livekit_ws_url or self.livekit_url

    def livekit_enabled(self) -> bool:
        """トークン発行に必要な鍵が揃っているか（未設定なら token API を 503 に）。"""
        return bool(self.livekit_api_key and self.livekit_api_secret)

    # ===========================================
    # QoS設定（認知負荷軽減のため）
    # ===========================================
    max_latency_ms: int = 1200  # 最大許容遅延
    max_jitter_ms: int = 200  # 最大許容ジッター

    # ===========================================
    # CORS設定
    # ポート変更は .env の FRONTEND_PORT / HOST_IP のみ変更すれば自動反映。
    # ここにハードコードされたポート番号は存在しない。
    # ===========================================
    host_ip: str = "localhost"
    # 環境変数 FRONTEND_PORT を自動読み込み（ポート変更時は .env のみ変更）
    frontend_port: int = 5273
    # 追加許可オリジン（省略可。HOST_IP + frontend_port は get_cors_origins() で自動生成）
    cors_origins: list[str] = []

    def get_cors_origins(self) -> list[str]:
        """
        CORS許可オリジンを動的生成

        HOST_IP と frontend_port（環境変数 FRONTEND_PORT）から自動生成するため、
        ポート変更は .env の FRONTEND_PORT を書き換えるだけで反映される。
        cors_origins フィールドに追加オリジンを指定することも可能。
        """
        origins = set(self.cors_origins)
        # HOST_IP が設定されていればLAN向けオリジンを追加
        if self.host_ip and self.host_ip != "localhost":
            origins.add(f"http://{self.host_ip}:{self.frontend_port}")
        # localhost系は常に含める（ポート番号は FRONTEND_PORT から取得）
        origins.add(f"http://localhost:{self.frontend_port}")
        origins.add(f"http://127.0.0.1:{self.frontend_port}")
        return list(origins)

    # ===========================================
    # 環境設定
    # ===========================================
    env: str = "development"

    # ===========================================
    # 対応言語（日本語、英語、中国語、ベトナム語）
    # ===========================================
    supported_languages: list[str] = ["ja", "en", "zh", "vi"]

    class Config:
        """Pydantic設定"""

        env_file = ".env"
        extra = "ignore"

    def __init__(self, **kwargs: object) -> None:
        """secrets.json から API キーを補完（環境変数/.env より低優先度）"""
        super().__init__(**kwargs)
        if not self.openai_api_key:
            self.openai_api_key = _get_secret("OPENAI_API_KEY")
        if not self.deepgram_api_key:
            self.deepgram_api_key = _get_secret("DEEPGRAM_API_KEY")
        if not self.gemini_api_key:
            self.gemini_api_key = _get_secret("GEMINI_API_KEY")


@lru_cache
def get_settings() -> Settings:
    """
    設定インスタンスを取得（キャッシュ済み）

    API Key優先順位: 環境変数 > .env

    Returns:
        Settings: アプリケーション設定
    """
    return Settings()


settings = get_settings()
