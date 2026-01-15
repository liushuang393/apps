"""
LAMS メインアプリケーション
言語感知型会議システムのエントリーポイント
"""

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.auth.routes import router as auth_router
from app.config import settings
from app.db.database import init_db
from app.rooms.routes import router as rooms_router
from app.websocket.handler import router as ws_router


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncGenerator[None, None]:
    """
    アプリケーションライフサイクル管理
    起動時: データベース初期化
    終了時: クリーンアップ
    """
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
app.include_router(ws_router, prefix="/ws", tags=["WebSocket"])


@app.get("/health")
async def health_check() -> dict[str, str]:
    """ヘルスチェックエンドポイント"""
    return {"status": "ok", "service": "lams"}
