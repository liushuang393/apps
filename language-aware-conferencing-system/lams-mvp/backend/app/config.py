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

    API Key優先順位: 環境変数 > .env > secrets.json
    デフォルト値は開発環境用。本番環境では必ず環境変数で上書きすること。
    """

    # ===========================================
    # データベース設定
    # ローカル開発時はDocker DB（host.docker.internal:5433）を使用
    # ===========================================
    database_url: str = "postgresql://lams:lams_secret_2024@host.docker.internal:5433/lams"

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
    # プロバイダー選択（gemini または openai_realtime）
    ai_provider: Literal["gemini", "openai_realtime"] = "gemini"

    # Gemini API 設定（secrets.jsonからも取得可能）
    gemini_api_key: str | None = None
    gemini_base_url: str | None = None  # カスタムエンドポイント（オプション）
    # Live API用モデル（WebSocketストリーミング）
    gemini_model: str = "models/gemini-2.5-flash-native-audio-preview-12-2025"
    # generateContent API用モデル（ASR/翻訳）
    gemini_text_model: str = "models/gemini-2.5-flash"

    # OpenAI Realtime API 設定（secrets.jsonからも取得可能）
    openai_api_key: str | None = None
    openai_base_url: str | None = None  # カスタムエンドポイント（オプション）
    openai_realtime_model: str = (
        "gpt-realtime-2025-08-28"  # または gpt-realtime-mini-2025-10-06
    )

    # ===========================================
    # QoS設定（認知負荷軽減のため）
    # ===========================================
    max_latency_ms: int = 1200  # 最大許容遅延
    max_jitter_ms: int = 200  # 最大許容ジッター

    # ===========================================
    # CORS設定
    # 環境変数 HOST_IP で自動設定、または CORS_ORIGINS で直接指定
    # ===========================================
    host_ip: str = "localhost"
    cors_origins: list[str] = ["http://localhost:5173"]

    def get_cors_origins(self) -> list[str]:
        """
        CORS許可オリジンを取得
        HOST_IP から自動生成、または cors_origins を使用
        """
        origins = set(self.cors_origins)
        # HOST_IP が設定されていれば追加
        if self.host_ip and self.host_ip != "localhost":
            origins.add(f"http://{self.host_ip}:5173")
        # localhost系は常に含める
        origins.add("http://localhost:5173")
        origins.add("http://127.0.0.1:5173")
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

    def __init__(self, **kwargs):
        """
        設定初期化

        secrets.json からの値を環境変数が未設定の場合に適用
        """
        super().__init__(**kwargs)
        # secrets.json からAPIキーを補完（環境変数/.envより低優先度）
        if not self.gemini_api_key:
            self.gemini_api_key = _get_secret("GEMINI_API_KEY")
        if not self.openai_api_key:
            self.openai_api_key = _get_secret("OPENAI_API_KEY")


@lru_cache
def get_settings() -> Settings:
    """
    設定インスタンスを取得（キャッシュ済み）

    API Key優先順位: 環境変数 > .env > secrets.json

    Returns:
        Settings: アプリケーション設定
    """
    return Settings()


settings = get_settings()
