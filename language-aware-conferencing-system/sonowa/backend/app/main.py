"""
Sonowa メインアプリケーション
言語感知型会議システムのエントリーポイント
"""

import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.admin.routes import router as admin_router
from app.ai_pipeline.experiment_routes import router as experiment_router
from app.ai_pipeline.rerun_routes import router as rerun_router
from app.auth.routes import router as auth_router
from app.config import settings
from app.db.database import init_db
from app.meetings.routes import router as meetings_router
from app.rooms.routes import router as rooms_router
from app.translate.glossary_routes import router as glossary_router
from app.translate.routes import router as translate_router
from app.translate.subtitle_routes import router as subtitle_router

logger = logging.getLogger(__name__)

DEFAULT_JWT_SECRET = "change-me-in-production"
# 本番で拒否する既知の開発用値（config / docker-compose の既定値）。
KNOWN_DEV_SECRETS = frozenset(
    {
        DEFAULT_JWT_SECRET,
        "sonowa-jwt-secret-change-in-production",
        "devsecret_change_in_production",
    }
)
MIN_SECRET_LENGTH = 32


def _validate_security_settings() -> None:
    """本番環境で既知・短すぎる JWT / LiveKit シークレットを起動前に拒否する。"""
    if settings.env.lower() != "production":
        return
    for name, value in (
        ("JWT_SECRET", settings.jwt_secret),
        ("LIVEKIT_API_SECRET", settings.livekit_api_secret),
    ):
        if not value or value in KNOWN_DEV_SECRETS or len(value) < MIN_SECRET_LENGTH:
            raise RuntimeError(
                f"本番環境の {name} には既定値以外の{MIN_SECRET_LENGTH}文字以上の値が必要です"
            )


def _validate_api_keys() -> None:
    """
    起動時にAPIキーの設定を検証

    OpenAI APIキーは必須（ASR/翻訳/TTSで使用）
    Gemini APIキーはオプション（将来の拡張用）
    """
    # OpenAI APIキーは必須
    if not settings.openai_api_key:
        logger.error(
            "=" * 60 + "\n"
            "[FATAL] OPENAI_API_KEY が設定されていません！\n"
            "音声認識(ASR)、翻訳、音声合成(TTS)が動作しません。\n"
            "環境変数（推奨）または .env に OPENAI_API_KEY を設定してください。\n"
            + "="
            * 60
        )
    else:
        # APIキーの形式チェック（sk-で始まるか）
        if not settings.openai_api_key.startswith("sk-"):
            logger.warning(
                "[WARNING] OPENAI_API_KEY の形式が不正な可能性があります "
                "(通常は 'sk-' で始まります)"
            )
        else:
            logger.info("[OK] OPENAI_API_KEY が設定されています")

    # Gemini APIキーはオプション
    if settings.gemini_api_key:
        logger.info("[OK] GEMINI_API_KEY が設定されています（オプション）")
    else:
        logger.info("[INFO] GEMINI_API_KEY は未設定（オプション）")

    # AI_PROVIDER の確認（env ブートストラップ。実行時は SystemConfig 上書き可）
    logger.info(f"[CONFIG] AI_PROVIDER(env) = {settings.ai_provider}")


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncGenerator[None, None]:
    """
    アプリケーションライフサイクル管理
    起動時: データベース初期化、APIキー検証
    終了時: クリーンアップ
    """
    # APIキー検証
    _validate_security_settings()
    _validate_api_keys()
    # データベース初期化
    await init_db()
    # AI パイプライン設定を DB からロード（無ければ env 既定）
    from app.ai_pipeline.effective_config import (
        env_pipeline_defaults,
        load_pipeline_settings_from_db,
    )
    from app.db.database import async_session

    async with async_session() as db:
        effective = await load_pipeline_settings_from_db(db)
    env_defaults = env_pipeline_defaults()
    logger.info(
        "[CONFIG] AI pipeline effective=%s env_defaults=%s",
        effective.to_dict(),
        env_defaults.to_dict(),
    )
    from app.ai_pipeline.local_warmup import prepare_local_pipeline

    await prepare_local_pipeline(effective)
    yield
    # 終了時: 常駐 Agent worker を停止（autostart 有効時のみ実体を持つ）
    from app.webrtc.supervisor import agent_supervisor

    await agent_supervisor.stop_all()


app = FastAPI(
    title="Sonowa API",
    description="言語感知型会議システム - Language-Aware Meeting System",
    version="0.1.0",
    lifespan=lifespan,
)

# CORSミドルウェア設定
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.get_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ルーター登録
app.include_router(auth_router, prefix="/api/auth", tags=["認証"])
app.include_router(rooms_router, prefix="/api/rooms", tags=["会議室"])
app.include_router(meetings_router, prefix="/api/meetings", tags=["会議モード"])
app.include_router(admin_router, prefix="/api/admin", tags=["管理者"])
app.include_router(rerun_router, prefix="/api/admin", tags=["離線重跑"])
app.include_router(experiment_router, prefix="/api/admin", tags=["A/Bテスト"])
app.include_router(translate_router, prefix="/api/translate", tags=["翻訳"])
app.include_router(subtitle_router, prefix="/api/translate", tags=["翻訳"])
app.include_router(glossary_router, prefix="/api/glossaries", tags=["用語集"])


@app.get("/health")
async def health_check() -> dict[str, str]:
    """ヘルスチェックエンドポイント"""
    return {"status": "ok", "service": "sonowa"}
