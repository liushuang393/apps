"""
初期ユーザー投入 CLI（管理者 1 名 + 一般ユーザー 1 名）

目的: 新規構築直後は管理者が存在せず /admin に入れないため、DB 作成・マイグレーション後に
      管理者と一般ユーザーを作成する。
使い方（backend コンテナ内）:
    python -m app.auth.seed_users                  # 無ければ作成、あればロール・有効化のみ補正
    python -m app.auth.seed_users --reset-password # 既存ユーザーのパスワードも設定し直す
環境変数:
    SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD（既定メール demo.admin@example.com）
    SEED_USER_EMAIL  / SEED_USER_PASSWORD （既定メール demo.user@example.com）
注意:
    - パスワードはハードコードしない。未指定なら乱数で生成し、そのときだけ 1 回表示する。
    - 既存ユーザーのパスワードは --reset-password を付けない限り変更しない（冪等）。
"""

import argparse
import asyncio
import logging
import os
import secrets
import sys
from dataclasses import dataclass
from typing import Protocol

from sqlalchemy import select

from app.auth.jwt_handler import hash_password
from app.auth.routes import MIN_PASSWORD_LENGTH
from app.db.models import User, UserRole

logger = logging.getLogger("seed_users")

# 生成パスワードの乱数バイト数（hex で 2 倍の文字数になる）
GENERATED_PASSWORD_BYTES = 6


@dataclass(frozen=True)
class SeedSpec:
    """投入するユーザー 1 名分の定義"""

    email: str
    display_name: str
    native_language: str
    role: str
    password: str


class _Session(Protocol):
    """upsert_user が必要とする AsyncSession の最小インターフェース"""

    async def execute(self, statement: object) -> object: ...

    def add(self, instance: object) -> None: ...

    async def commit(self) -> None: ...


def resolve_password(value: str | None) -> tuple[str, bool]:
    """
    指定パスワードを検証する。未指定（None / 空）なら乱数で生成する。
    出力: (パスワード, 生成したか)
    """
    if not value:
        return f"Sonowa-{secrets.token_hex(GENERATED_PASSWORD_BYTES)}", True
    if len(value) < MIN_PASSWORD_LENGTH:
        raise ValueError(f"パスワードは {MIN_PASSWORD_LENGTH} 文字以上にしてください")
    return value, False


async def upsert_user(db: _Session, spec: SeedSpec, *, reset_password: bool) -> str:
    """
    ユーザーを作成または補正する。
    出力: "created" / "password-reset" / "updated" / "unchanged"
    注意: パスワード再設定時はトークン世代を進め、既存セッションを失効させる。
    """
    result = await db.execute(select(User).where(User.email == spec.email))
    user = result.scalar_one_or_none()  # type: ignore[attr-defined]
    if user is None:
        db.add(
            User(
                email=spec.email,
                password_hash=hash_password(spec.password),
                display_name=spec.display_name,
                native_language=spec.native_language,
                role=spec.role,
                is_active=True,
            )
        )
        await db.commit()
        return "created"

    changed = user.role != spec.role or not user.is_active
    user.role = spec.role
    user.is_active = True
    if reset_password:
        user.password_hash = hash_password(spec.password)
        user.token_version = (user.token_version or 0) + 1
    if not (changed or reset_password):
        return "unchanged"
    await db.commit()
    return "password-reset" if reset_password else "updated"


def _specs() -> list[tuple[SeedSpec, bool]]:
    """環境変数から 2 名分の定義を組み立てる（(定義, パスワードを生成したか)）"""
    rows = [
        ("ADMIN", "demo.admin@example.com", "Demo Admin", "ja", UserRole.ADMIN.value),
        ("USER", "demo.user@example.com", "Demo User", "en", UserRole.USER.value),
    ]
    specs: list[tuple[SeedSpec, bool]] = []
    for key, email, name, lang, role in rows:
        password, generated = resolve_password(os.environ.get(f"SEED_{key}_PASSWORD"))
        spec = SeedSpec(
            email=os.environ.get(f"SEED_{key}_EMAIL") or email,
            display_name=name,
            native_language=lang,
            role=role,
            password=password,
        )
        specs.append((spec, generated))
    return specs


async def _run(reset_password: bool) -> None:
    # 遅延 import: テストで DB 接続設定を読み込まないため
    from app.db.database import async_session

    async with async_session() as db:
        for spec, generated in _specs():
            status = await upsert_user(db, spec, reset_password=reset_password)
            # 生成したパスワードを実際に設定したときだけ表示する（指定値は表示しない）
            if status not in ("created", "password-reset"):
                shown = "(変更なし)"
            elif generated:
                shown = spec.password
            else:
                shown = "(SEED_*_PASSWORD の値)"
            logger.info(
                "%s role=%s status=%s password=%s", spec.email, spec.role, status, shown
            )


def main() -> None:
    """CLI エントリーポイント"""
    parser = argparse.ArgumentParser(
        description="初期ユーザー（管理者・一般）を投入する"
    )
    parser.add_argument(
        "--reset-password",
        action="store_true",
        help="既存ユーザーのパスワードも設定し直す",
    )
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s", stream=sys.stdout)
    try:
        asyncio.run(_run(args.reset_password))
    except ValueError as exc:
        logger.error("%s", exc)
        sys.exit(1)


if __name__ == "__main__":
    main()
