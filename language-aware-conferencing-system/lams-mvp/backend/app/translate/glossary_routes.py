"""
LAMS 用語集（Glossary）管理 API

目的:
    企業用語・固有名詞・翻訳禁止語の登録/参照/更新/削除（CRUD）を提供する。
    更新時は用語集キャッシュを無効化し、翻訳パイプラインへ即時反映する。
権限:
    全エンドポイントで管理者権限（require_admin）を要求する。
注意点:
    do_not_translate=False の用語は target_term 必須。
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import require_admin
from app.db.database import get_db
from app.db.models import GlossaryTerm, User
from app.translate import glossary

logger = logging.getLogger(__name__)
router = APIRouter()

MAX_TERM_LENGTH = 255


class GlossaryTermCreate(BaseModel):
    """用語登録リクエスト"""

    source_language: str
    target_language: str
    source_term: str
    target_term: str | None = None
    term_type: str = "general"
    priority: int = 100
    do_not_translate: bool = False
    enabled: bool = True
    tenant_id: str | None = None

    @field_validator("source_term")
    @classmethod
    def _source_term_not_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("source_term は必須です")
        return v


class GlossaryTermUpdate(BaseModel):
    """用語更新リクエスト（部分更新）"""

    source_language: str | None = None
    target_language: str | None = None
    source_term: str | None = None
    target_term: str | None = None
    term_type: str | None = None
    priority: int | None = None
    do_not_translate: bool | None = None
    enabled: bool | None = None


class GlossaryTermResponse(BaseModel):
    """用語レスポンス"""

    id: str
    source_language: str
    target_language: str
    source_term: str
    target_term: str | None
    term_type: str
    priority: int
    do_not_translate: bool
    enabled: bool
    tenant_id: str | None

    class Config:
        from_attributes = True


def _validate_translation_term(do_not_translate: bool, target_term: str | None) -> None:
    """翻訳語の整合性検証（翻訳対象なら target_term 必須）"""
    if not do_not_translate and (not target_term or not target_term.strip()):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="do_not_translate=False の場合 target_term は必須です",
        )


@router.post(
    "/terms", response_model=GlossaryTermResponse, status_code=status.HTTP_201_CREATED
)
async def create_term(
    req: GlossaryTermCreate,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> GlossaryTerm:
    """用語を新規登録する"""
    _validate_translation_term(req.do_not_translate, req.target_term)
    term = GlossaryTerm(**req.model_dump())
    db.add(term)
    await db.commit()
    await db.refresh(term)
    glossary.invalidate_cache()
    logger.info(f"[Glossary] 用語登録: {term.source_term} ({term.id})")
    return term


@router.get("/terms", response_model=list[GlossaryTermResponse])
async def list_terms(
    source_language: str | None = Query(default=None),
    target_language: str | None = Query(default=None),
    enabled: bool | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> list[GlossaryTerm]:
    """用語一覧を取得する（言語ペア・有効フラグで絞り込み可能）"""
    stmt = select(GlossaryTerm)
    if source_language:
        stmt = stmt.where(GlossaryTerm.source_language == source_language)
    if target_language:
        stmt = stmt.where(GlossaryTerm.target_language == target_language)
    if enabled is not None:
        stmt = stmt.where(GlossaryTerm.enabled.is_(enabled))
    stmt = stmt.order_by(GlossaryTerm.priority.desc())
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def _get_term_or_404(db: AsyncSession, term_id: str) -> GlossaryTerm:
    """ID で用語を取得（存在しなければ 404）"""
    result = await db.execute(select(GlossaryTerm).where(GlossaryTerm.id == term_id))
    term = result.scalar_one_or_none()
    if not term:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="用語が見つかりません"
        )
    return term


@router.get("/terms/{term_id}", response_model=GlossaryTermResponse)
async def get_term(
    term_id: str,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> GlossaryTerm:
    """用語を ID で取得する"""
    return await _get_term_or_404(db, term_id)


@router.patch("/terms/{term_id}", response_model=GlossaryTermResponse)
async def update_term(
    term_id: str,
    req: GlossaryTermUpdate,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> GlossaryTerm:
    """用語を部分更新する"""
    term = await _get_term_or_404(db, term_id)
    updates = req.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(term, field, value)
    # 更新後の整合性検証（翻訳対象なら target_term 必須）
    _validate_translation_term(term.do_not_translate, term.target_term)
    await db.commit()
    await db.refresh(term)
    glossary.invalidate_cache()
    logger.info(f"[Glossary] 用語更新: {term.id}")
    return term


@router.delete("/terms/{term_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_term(
    term_id: str,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> None:
    """用語を削除する"""
    term = await _get_term_or_404(db, term_id)
    await db.delete(term)
    await db.commit()
    glossary.invalidate_cache()
    logger.info(f"[Glossary] 用語削除: {term_id}")
