"""
LAMS データベースモデル
ユーザー、会議室、設定の定義
"""

import uuid
from datetime import datetime, timezone
from enum import Enum

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    true,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    """SQLAlchemy ベースクラス"""

    pass


def generate_uid() -> str:
    """UUID生成ヘルパー"""
    return str(uuid.uuid4())


def utc_now() -> datetime:
    """現在時刻（UTC）取得ヘルパー"""
    return datetime.now(timezone.utc)


class UserRole(str, Enum):
    """
    ユーザーロール定義
    RBAC（Role-Based Access Control）用
    """

    ADMIN = "admin"  # 管理者：全権限
    MODERATOR = "moderator"  # モデレーター：会議室管理
    USER = "user"  # 一般ユーザー：基本機能のみ


class MeetingMode(str, Enum):
    """
    会議モード定義（README §0 / Phase 3 ハイブリッド設計）

    目的:
        「聞く主線（S2S 翻訳音声）」と「読む主線（ASR+MT 字幕/記録）」のどちらを
        駆動するかを会議/セッション単位で表現する。2 主線は混ぜず、Gateway での
        音声複製のみで分岐する（絶対原則）。
    値:
        - A      : 聞く主線のみ（OpenAI/Gemini S2S → 翻訳音声）。字幕は付随的。
        - B      : 読む主線のみ（Google ASR + MT + 用語集 → 字幕/議事録）。
        - HYBRID : 両主線を同時駆動（同一発話を複製し、聞く=S2S／読む=字幕）。
    """

    A = "a"  # 聞く主線のみ（S2S 音声翻訳）
    B = "b"  # 読む主線のみ（ASR+MT 字幕）
    HYBRID = "hybrid"  # 同時 2 主線


class User(Base):
    """
    ユーザーモデル
    社内メンバーの認証情報と言語設定を管理
    """

    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uid)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    display_name: Mapped[str] = mapped_column(String(100))

    # 母語設定（翻訳先のデフォルト言語）
    native_language: Mapped[str] = mapped_column(String(10), default="ja")

    # ロール（RBAC）
    role: Mapped[str] = mapped_column(String(20), default=UserRole.USER.value)

    # アカウント状態
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now
    )

    # リレーション
    created_rooms: Mapped[list["Room"]] = relationship(back_populates="creator")

    def has_role(self, *roles: UserRole) -> bool:
        """指定されたロールのいずれかを持っているかチェック"""
        return self.role in [r.value for r in roles]

    @property
    def is_admin(self) -> bool:
        """管理者かどうか"""
        return self.role == UserRole.ADMIN.value

    @property
    def is_moderator(self) -> bool:
        """モデレーター以上かどうか"""
        return self.role in [UserRole.ADMIN.value, UserRole.MODERATOR.value]


class PasswordResetToken(Base):
    """
    パスワードリセットトークンモデル
    パスワード忘れ時のリセット用トークンを管理
    """

    __tablename__ = "password_reset_tokens"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    token: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now
    )

    # リレーション
    user: Mapped["User"] = relationship()


class MeetingSession(Base):
    """
    会議セッションモデル
    一つの会議室で複数回の会議を管理

    セッションライフサイクル:
    - 開始: 最初の参加者が発言した時点
    - 終了: 全参加者が退室した時点
    """

    __tablename__ = "meeting_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uid)
    room_id: Mapped[str] = mapped_column(ForeignKey("rooms.id"), index=True)

    # セッション開始・終了時刻
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now
    )
    ended_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # セッション状態
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    # アクティブな会議モード（a / b / hybrid）。Room.default_mode を初期値とし、
    # 進行中に PATCH /api/meetings/{id}/mode で切替可能（Phase 3 Mode Router の入力）。
    mode: Mapped[str] = mapped_column(
        String(10),
        default=MeetingMode.HYBRID.value,
        server_default=MeetingMode.HYBRID.value,
    )

    # リレーション
    room: Mapped["Room"] = relationship()
    subtitles: Mapped[list["Subtitle"]] = relationship(back_populates="session")


class Subtitle(Base):
    """
    字幕モデル
    会議の発言記録を保存（多言語翻訳含む）
    """

    __tablename__ = "subtitles"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uid)
    room_id: Mapped[str] = mapped_column(ForeignKey("rooms.id"), index=True)
    # セッションID（会議回ごとに字幕を分離）
    session_id: Mapped[str | None] = mapped_column(
        ForeignKey("meeting_sessions.id"), index=True, nullable=True
    )
    speaker_id: Mapped[str] = mapped_column(ForeignKey("users.id"))

    # 原文
    original_text: Mapped[str] = mapped_column(Text)
    original_language: Mapped[str] = mapped_column(String(10))

    # 翻訳結果（JSON: {"en": "Hello", "zh": "你好", ...}）
    translations: Mapped[dict] = mapped_column(JSON, default=dict)

    # タイムスタンプ
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, index=True
    )

    # リレーション
    room: Mapped["Room"] = relationship()
    session: Mapped["MeetingSession | None"] = relationship(back_populates="subtitles")
    speaker: Mapped["User"] = relationship()


class Room(Base):
    """
    会議室モデル
    会議の言語ポリシーを管理
    """

    __tablename__ = "rooms"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uid)
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    creator_id: Mapped[str] = mapped_column(ForeignKey("users.id"))

    # 会議言語ポリシー
    allowed_languages: Mapped[list[str]] = mapped_column(
        JSON, default=lambda: ["ja", "en", "zh", "vi"]
    )
    default_audio_mode: Mapped[str] = mapped_column(
        String(20),
        default="original",  # original または translated
    )
    allow_mode_switch: Mapped[bool] = mapped_column(Boolean, default=True)

    # ===========================================
    # Phase 3 会議モード設定（README §0 / ハイブリッド 2 主線）
    # transport 非依存。新規セッション開始時の既定モードと主線ルーティングを保持。
    # ===========================================
    # 会議の既定モード（a / b / hybrid）。新規 MeetingSession.mode の初期値。
    default_mode: Mapped[str] = mapped_column(
        String(10),
        default=MeetingMode.HYBRID.value,
        server_default=MeetingMode.HYBRID.value,
    )
    # 聞く主線（OpenAI/Gemini S2S 翻訳音声）を会議レベルで許可するか。
    # False の場合 hybrid でも読む主線（字幕）のみに縮退する。
    enable_openai_s2s: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=true()
    )
    # 言語ペア単位の主線/プロバイダー上書き（Mode Router 入力）。
    # 例: {"ja->en": {"mode": "b"}, "en->ja": {"s2s_provider": "gemini_live"}}
    # 空辞書なら会議既定（default_mode / enable_openai_s2s）に従う。
    language_routes: Mapped[dict] = mapped_column(JSON, default=dict)

    # 私有/公開設定（私有会議は作成者以外一覧に表示されない）
    is_private: Mapped[bool] = mapped_column(Boolean, default=False)

    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now
    )

    # リレーション
    creator: Mapped["User"] = relationship(back_populates="created_rooms")


class SystemConfig(Base):
    """
    システム全体設定モデル
    言語設定など、システム全体で共有される設定を管理
    """

    __tablename__ = "system_config"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    key: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    value: Mapped[str] = mapped_column(Text)  # JSON文字列で保存
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )
    updated_by: Mapped[str | None] = mapped_column(String(36), nullable=True)


class GlossaryTerm(Base):
    """
    用語集（Glossary）モデル

    目的:
        Mode B（ASR→MT+用語集→字幕）の精度の核。企業ごとの固有名詞・専門用語・
        翻訳禁止語を登録し、翻訳パイプラインで指定訳を強制する。
    注意点:
        - provider / transport 非依存（翻訳エンジンの種類に関わらず適用）。
        - tenant_id は将来のマルチテナント拡張用。None はグローバル共通用語を表す。
        - do_not_translate が True の場合 target_term は未使用（原語を保持）。
    """

    __tablename__ = "glossary_term"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uid)

    # マルチテナント拡張用（None=グローバル共通）
    tenant_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)

    # 言語ペア（ja/en/zh/vi 等。region 付き ja-JP も許容し基底言語で照合）
    source_language: Mapped[str] = mapped_column(String(10))
    target_language: Mapped[str] = mapped_column(String(10))

    # 用語本体
    source_term: Mapped[str] = mapped_column(String(255), index=True)
    target_term: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # 用語種別（business / person / product 等。分析・運用向けの分類）
    term_type: Mapped[str] = mapped_column(String(30), default="general")

    # 適用優先度（大きいほど優先）
    priority: Mapped[int] = mapped_column(Integer, default=100)

    # 翻訳禁止語フラグ（True の場合は原語を保持）
    do_not_translate: Mapped[bool] = mapped_column(Boolean, default=False)

    # 有効/無効（無効化しても履歴は残す）
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )

    __table_args__ = (
        # 言語ペア＋有効フラグでの絞り込みを高速化（翻訳時のホットパス）
        Index(
            "ix_glossary_lookup",
            "source_language",
            "target_language",
            "enabled",
        ),
    )


class TranscriptSegment(Base):
    """
    文字起こしセグメント（改善.md 13.3 transcript_segment）。

    目的:
        Mode B（ASR→MT+用語集→字幕）の正式記録基盤。ASR の発話単位を
        provider / confidence / is_final / 時刻オフセット付きで保存し、議事録・
        検索・要約の一次ソースとする。
    注意点:
        - 既存 Subtitle（翻訳をJSONで保持する軽量字幕）とは別表で additive 追加。
          Subtitle を壊さず、richer なメタデータが必要な Mode B 用途を担う。
        - 翻訳は TranslationSegment に正規化して 1:N で保持する。
    """

    __tablename__ = "transcript_segment"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uid)
    room_id: Mapped[str] = mapped_column(ForeignKey("rooms.id"), index=True)
    # 会議回（meeting）。spec の meeting_id 相当を既存 MeetingSession に対応付ける
    session_id: Mapped[str | None] = mapped_column(
        ForeignKey("meeting_sessions.id"), index=True, nullable=True
    )
    speaker_id: Mapped[str] = mapped_column(ForeignKey("users.id"))

    source_language: Mapped[str] = mapped_column(String(10))

    # 発話の時刻オフセット（ミリ秒。ストリーミング ASR の区間情報）
    start_time_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    end_time_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)

    text: Mapped[str] = mapped_column(Text)

    # ASR 信頼度（0.0-1.0）。低信頼度は字幕で注意表示に使う
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    # partial / final の区別（partial は後続 final で上書きされ得る）
    is_final: Mapped[bool] = mapped_column(Boolean, default=True)
    # ASR プロバイダー（google, deepgram, gpt4o_transcribe 等）
    provider: Mapped[str | None] = mapped_column(String(30), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, index=True
    )

    # リレーション
    room: Mapped["Room"] = relationship()
    session: Mapped["MeetingSession | None"] = relationship()
    speaker: Mapped["User"] = relationship()
    translations: Mapped[list["TranslationSegment"]] = relationship(
        back_populates="transcript", cascade="all, delete-orphan"
    )

    __table_args__ = (
        # 会議回ごとの時系列読み出しを高速化（議事録・transcript 取得のホットパス）
        Index("ix_transcript_session_time", "session_id", "created_at"),
    )


class TranslationSegment(Base):
    """
    翻訳セグメント（改善.md 13.4 translation_segment）。

    目的:
        TranscriptSegment 1件に対する各 target_language の翻訳結果を、MT provider /
        LLM 補正 provider / 用語集バージョン / 品質スコア付きで正規化保存する。
    注意点:
        - transcript_segment_id に対し target_language ごとに 1行（再翻訳は追加行）。
        - glossary_version は適用した用語集の版を記録し、再現性・監査に用いる。
    """

    __tablename__ = "translation_segment"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uid)
    transcript_segment_id: Mapped[str] = mapped_column(
        ForeignKey("transcript_segment.id"), index=True
    )

    source_language: Mapped[str] = mapped_column(String(10))
    target_language: Mapped[str] = mapped_column(String(10))

    translated_text: Mapped[str] = mapped_column(Text)

    # MT プロバイダー（google, openai 等）
    provider: Mapped[str | None] = mapped_column(String(30), nullable=True)
    # 翻訳後補正に用いた LLM（gemini, gpt 等。未補正は None）
    llm_provider: Mapped[str | None] = mapped_column(String(30), nullable=True)
    # 適用した用語集の版（監査・再現用）
    glossary_version: Mapped[str | None] = mapped_column(String(50), nullable=True)
    # 翻訳品質スコア（0.0-1.0。評価・並び替え用）
    quality_score: Mapped[float | None] = mapped_column(Float, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now
    )

    # リレーション
    transcript: Mapped["TranscriptSegment"] = relationship(
        back_populates="translations"
    )

    __table_args__ = (
        # セグメント＋対象言語での絞り込みを高速化
        Index(
            "ix_translation_lookup",
            "transcript_segment_id",
            "target_language",
        ),
    )
