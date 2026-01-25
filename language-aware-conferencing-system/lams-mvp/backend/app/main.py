"""
LAMS メインアプリケーション
言語感知型会議システムのエントリーポイント
"""

import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.admin.routes import router as admin_router
from app.auth.routes import router as auth_router
from app.config import settings
from app.db.database import init_db
from app.rooms.routes import router as rooms_router
from app.translate.routes import router as translate_router
from app.websocket.handler import router as ws_router

logger = logging.getLogger(__name__)


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
            ".env ファイルに OPENAI_API_KEY を設定してください。\n" + "=" * 60
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

    # AI_PROVIDER の確認
    logger.info(f"[CONFIG] AI_PROVIDER = {settings.ai_provider}")


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncGenerator[None, None]:
    """
    アプリケーションライフサイクル管理
    起動時: データベース初期化、APIキー検証
    終了時: クリーンアップ
    """
    # APIキー検証
    _validate_api_keys()
    # データベース初期化
    await init_db()
    yield


app = FastAPI(
    title="LAMS API",
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
app.include_router(admin_router, prefix="/api/admin", tags=["管理者"])
app.include_router(translate_router, prefix="/api/translate", tags=["翻訳"])
app.include_router(ws_router, prefix="/ws", tags=["WebSocket"])


@app.get("/health")
async def health_check() -> dict[str, str]:
    """ヘルスチェックエンドポイント"""
    return {"status": "ok", "service": "lams"}
