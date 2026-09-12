"""Alembic マイグレーション用の冪等ガード。

目的:
    Alembic 導入前・導入途中に ``Base.metadata.create_all`` で先に作成された
    テーブル／索引／列が残る永続ボリュームに対しても、``alembic upgrade head`` を
    非破壊で収束させる。

背景:
    起動時 create_all は「未適用マイグレーションのテーブルを先に作る」一方で
    「既存テーブルへ列を追加しない」。この非対称性により、alembic_version が古い
    まま新テーブルだけが存在するドリフトが発生し、後続マイグレーションの
    ``create_table`` が DuplicateTable で失敗して以降の列追加が永久に適用されない。

注意:
    既存オブジェクトは一切変更・削除しない（存在すれば skip するだけ）。
    スキーマ定義の権威は各マイグレーションであり、本モジュールは判定のみを担う。
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op


def has_table(name: str) -> bool:
    """テーブルが既に存在するかを返す。

    Args:
        name: テーブル名。

    Returns:
        存在すれば True。
    """
    return sa.inspect(op.get_bind()).has_table(name)


def has_column(table: str, column: str) -> bool:
    """テーブルに指定列が既に存在するかを返す。

    Args:
        table: テーブル名。
        column: 列名。

    Returns:
        存在すれば True。テーブル自体が無い場合も False。
    """
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table(table):
        return False
    return column in {col["name"] for col in inspector.get_columns(table)}


def has_index(table: str, name: str) -> bool:
    """テーブルに指定名の索引が既に存在するかを返す。

    Args:
        table: テーブル名。
        name: 索引名。

    Returns:
        存在すれば True。テーブル自体が無い場合も False。
    """
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table(table):
        return False
    return name in {index["name"] for index in inspector.get_indexes(table)}


def create_table_if_absent(name: str, *columns: object) -> None:
    """テーブルが無いときだけ作成する（既存は尊重して skip）。

    Args:
        name: テーブル名。
        *columns: ``op.create_table`` へ渡す列・制約定義。

    Returns:
        None。
    """
    if not has_table(name):
        op.create_table(name, *columns)


def create_index_if_absent(
    name: str,
    table: str,
    columns: list[str],
    *,
    unique: bool = False,
) -> None:
    """索引が無いときだけ作成する（既存は尊重して skip）。

    Args:
        name: 索引名。
        table: 対象テーブル名。
        columns: 索引対象の列名リスト。
        unique: 一意索引にするか。

    Returns:
        None。
    """
    if not has_index(table, name):
        op.create_index(name, table, columns, unique=unique)


def add_column_if_absent(table: str, column: sa.Column) -> None:
    """列が無いときだけ追加する（既存は尊重して skip）。

    Args:
        table: テーブル名。
        column: 追加する列定義。

    Returns:
        None。
    """
    if not has_column(table, column.name):
        op.add_column(table, column)
