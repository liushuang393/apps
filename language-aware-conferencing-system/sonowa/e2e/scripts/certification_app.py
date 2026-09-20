"""製品アプリへ検証専用のDB実体プローブを加えるDocker限定エントリーポイント。

製品イメージ・公開APIは変更しない。このファイルを明示的にマウントした
専用ランタイムだけが、実接続DBとseed所有者を読み出すプローブを提供する。
"""

import os

from app.db.database import async_session
from app.main import app
from fastapi import HTTPException
from sqlalchemy import text


@app.get("/api/__testing_kit_identity", include_in_schema=False)
async def certification_identity() -> dict[str, str]:
    """専用DBのseedを照合し、実行実体の非秘密情報だけを返す。"""
    async with async_session() as db:
        if await db.scalar(text("SELECT current_database()")) != "sonowa_cert_e2e":
            raise HTTPException(status_code=503, detail="wrong certification database")
        row = (
            (
                await db.execute(
                    text(
                        "SELECT owner_id, app, environment, seed_marker FROM certification_identity"
                    )
                )
            )
            .mappings()
            .one()
        )
        if row["owner_id"] != os.environ["SONOWA_CERT_OWNER"]:
            raise HTTPException(status_code=503, detail="wrong certification owner")
        return {str(key): str(value) for key, value in row.items()}
