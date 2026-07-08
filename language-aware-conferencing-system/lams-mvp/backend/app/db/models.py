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
        default=MeetingMode.A.value,
        server_default=MeetingMode.A.value,
    )

    # 会議終了時に書き込む QoS サマリ（改善.md §15）。
    # 現状は数字保持率（number_retention_rate / number_samples）を記録する。
    # ponytail: 遅延 P95・用語命中率は runtime QoS モニタが orchestrator に
    # 配線されていないため null。配線時にここへ追記する。
    qos_summary: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    # リレーション
    room: Mapped["Room"] = relationship()


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
        default=MeetingMode.A.value,
        server_default=MeetingMode.A.value,
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


class Participant(Base):
    """
    参加者の永続記録（改善.md §13.2 participant）。

    目的:
        リアルタイムの参加者設定（Redis / room_manager）を会議後も残すための
        耐久レコード。監査・履歴・再入室時の設定復元の一次ソースとする。
    注意点:
        - Redis を真実とするのはライブ中のみ。本表は write-through の耐久コピー。
        - (room_id, user_id) で一意（upsert）。joined_at は初回参加、updated_at は
          設定変更時刻。ponytail: 会議回ごとの履歴が必要なら session_id 単位の行へ拡張。
    """

    __tablename__ = "participant"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uid)
    room_id: Mapped[str] = mapped_column(ForeignKey("rooms.id"), index=True)
    # 会議回（任意。参加時点でアクティブな MeetingSession があれば紐付ける）
    session_id: Mapped[str | None] = mapped_column(
        ForeignKey("meeting_sessions.id"), index=True, nullable=True
    )
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)

    display_name: Mapped[str] = mapped_column(String(100))
    # 母語（spec の preferred_language）
    preferred_language: Mapped[str] = mapped_column(String(10))
    # 受聴/出力言語（spec の output_language）
    output_language: Mapped[str] = mapped_column(String(10))
    # 翻訳音声を受信するか（audio_mode=translated 相当）
    voice_translation_enabled: Mapped[bool] = mapped_column(Boolean, default=False)

    joined_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )

    # リレーション
    room: Mapped["Room"] = relationship()
    user: Mapped["User"] = relationship()

    __table_args__ = (
        # 会議室＋ユーザーで一意（write-through の upsert キー）
        Index("ix_participant_room_user", "room_id", "user_id", unique=True),
    )


class TranscriptSegment(Base):
    """
    文字起こしセグメント（改善.md 13.3 transcript_segment）。

    目的:
        Mode B（ASR→MT+用語集→字幕）の正式記録基盤。ASR の発話単位を
        provider / confidence / is_final / 時刻オフセット付きで保存し、議事録・
        検索・要約の一次ソースとする。
    注意点:
        - 旧 Subtitle（翻訳を JSON で保持する軽量字幕）を置換する正式記録テーブル
          （migration 008 でデータ移行、009 で subtitles を drop 済み）。
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
    # 話者分離（P4-A）で識別/クラスタリングした表示ラベル（登録話者名 or "Speaker N"）。
    # speaker_id（LiveKit track 由来の権威）は不変で、本列は増強情報（未実行時 null）。
    speaker_label: Mapped[str | None] = mapped_column(String(100), nullable=True)

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


class DataSplit(str, Enum):
    """訓練データの分割（改善.md §5.2）。

    TRAIN は学習に使用可、HOLDOUT は学習に使わず内部検証用に取り置く。評価集
    （EvaluationSample）は物理的に別テーブルに置き、学習に混入しない不変条件を保つ。
    """

    TRAIN = "train"  # 学習に使用可
    HOLDOUT = "holdout"  # 学習に使わず内部検証で保持


class ASRCorrection(Base):
    """ASR 訂正ペア（改善.md §5.2 asr correction 層）。

    人手/後編集で確定した「ASR 生テキスト → 訂正テキスト」の対。ホットワード・
    後処理の改善、将来の Whisper LoRA/ドメイン微調整の教師データになる。
    audio_hash は元音声（暗号化アーカイブ）への参照キーで、音声自体は保存しない。
    """

    __tablename__ = "asr_correction"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uid)
    room_id: Mapped[str | None] = mapped_column(
        ForeignKey("rooms.id"), index=True, nullable=True
    )
    session_id: Mapped[str | None] = mapped_column(
        ForeignKey("meeting_sessions.id"), index=True, nullable=True
    )
    transcript_segment_id: Mapped[str | None] = mapped_column(
        ForeignKey("transcript_segment.id"), index=True, nullable=True
    )
    source_language: Mapped[str] = mapped_column(String(10), index=True)
    # 元音声（暗号化アーカイブ）参照。音声バイト列は DB に置かない（プライバシー）。
    audio_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    asr_text: Mapped[str] = mapped_column(Text)  # ASR 生出力
    corrected_text: Mapped[str] = mapped_column(Text)  # 訂正後
    corrected_by: Mapped[str | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    # 学習/内部検証の分割。評価集は別テーブルのためここに eval は存在しない。
    split: Mapped[str] = mapped_column(
        String(10), default=DataSplit.TRAIN.value, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, index=True
    )


class TranslationCorrection(Base):
    """翻訳訂正ペア（改善.md §5.2 translation correction 層）。

    「MT 出力 → 訂正訳」の対。用語一貫性・商務語気・数字保持の改善、OPUS/Marian
    微調整や LLM 後編集プロンプトの教師データになる。適用用語集版も記録する。
    """

    __tablename__ = "translation_correction"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uid)
    translation_segment_id: Mapped[str | None] = mapped_column(
        ForeignKey("translation_segment.id"), index=True, nullable=True
    )
    source_language: Mapped[str] = mapped_column(String(10), index=True)
    target_language: Mapped[str] = mapped_column(String(10), index=True)
    source_text: Mapped[str] = mapped_column(Text)
    mt_text: Mapped[str] = mapped_column(Text)  # MT 生出力
    corrected_text: Mapped[str] = mapped_column(Text)  # 訂正後
    corrected_by: Mapped[str | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    glossary_version: Mapped[str | None] = mapped_column(String(50), nullable=True)
    split: Mapped[str] = mapped_column(
        String(10), default=DataSplit.TRAIN.value, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, index=True
    )


class SpeakerEnrollment(Base):
    """話者エンロールメント（改善.md §5.2 speaker enrollment 層）。

    固定メンバー会議での話者分離精度向上に使う声紋 embedding。embedding は JSON
    ベクトル参照で保持し、必ず consent(同意) を伴う。用途外利用を防ぐ。
    """

    __tablename__ = "speaker_enrollment"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    room_id: Mapped[str | None] = mapped_column(
        ForeignKey("rooms.id"), index=True, nullable=True
    )
    speaker_label: Mapped[str] = mapped_column(String(100))
    # 声紋ベクトル（JSON 配列）または外部ストレージ参照。未取得時は None。
    embedding: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    consent: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )

    __table_args__ = (
        Index("ix_enrollment_user_label", "user_id", "speaker_label", unique=True),
    )


class TTSConsent(Base):
    """TTS 音色クローンの同意（改善.md §5.2 tts consent / §4.4 授権）。

    個人クローン音色は必ず本人同意 + 用途限定 + 透かし(watermark) を要件とする。
    granted/revoked で有効期間を管理し、無同意のデフォルト参会者クローンを禁じる。
    """

    __tablename__ = "tts_consent"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    voice_id: Mapped[str] = mapped_column(String(100), index=True)
    # 用途スコープ（例: この会議のみ / 組織内 / 全体）。文字列で保持。
    scope: Mapped[str] = mapped_column(String(30), default="meeting")
    granted: Mapped[bool] = mapped_column(Boolean, default=False)
    # 透かし必須（既定 True。合成音の出所追跡・悪用抑止）。
    watermark_required: Mapped[bool] = mapped_column(Boolean, default=True)
    granted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now
    )


class EvaluationSample(Base):
    """評価集サンプル（改善.md §5.2 evaluation set：**学習に永久に混入させない**）。

    WER/CER/BLEU/COMET 等の評価専用データ。訓練テーブル（*_correction）とは物理的に
    分離し、学習エクスポートは本テーブルを一切参照しない（不変条件）。
    """

    __tablename__ = "evaluation_sample"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uid)
    stage: Mapped[str] = mapped_column(String(20), index=True)  # asr / t2t / tts
    source_language: Mapped[str] = mapped_column(String(10), index=True)
    target_language: Mapped[str | None] = mapped_column(String(10), nullable=True)
    input_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    audio_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    reference_text: Mapped[str] = mapped_column(Text)  # 正解参照
    notes: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now
    )


class RerunStatus(str, Enum):
    """離線高質量重跑（P3-D）の状態機。

    PENDING は未処理、DONE は重跑完了、SKIPPED は対象外（音声も原文も無い等）、
    FAILED は重跑中に例外。冪等再実行は PENDING/FAILED のみを対象にできる。
    """

    PENDING = "pending"
    DONE = "done"
    SKIPPED = "skipped"
    FAILED = "failed"


class PipelineEvent(Base):
    """中間パイプライン事件（改善.md §5.3 / P3-D 離線重跑の回放ログ）。

    目的:
        1 発話の実時パイプライン出力（ASR 原文・言語別訳文・タグ・縮退フラグ・
        trace_id）と、暗号化アーカイブされた音声への参照（audio_hash）を保存し、
        会議後に最強モデルで離線再処理（rerun）できる回放基盤とする。
    注意点:
        - **音声バイト列は保存しない**。audio_hash は暗号化アーカイブの参照のみ。
          audio_hash が null の事件は音声なし＝MT のみ再処理可能（ASR 再処理不可）。
        - rerun_status で冪等な再実行を制御する（PENDING/FAILED のみ再処理対象）。
        - transcript_segment との 1:1 対応（NULL 可：保存失敗時も事件は残せる）。
    """

    __tablename__ = "pipeline_event"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uid)
    room_id: Mapped[str | None] = mapped_column(
        ForeignKey("rooms.id"), index=True, nullable=True
    )
    session_id: Mapped[str | None] = mapped_column(
        ForeignKey("meeting_sessions.id"), index=True, nullable=True
    )
    transcript_segment_id: Mapped[str | None] = mapped_column(
        ForeignKey("transcript_segment.id"), index=True, nullable=True
    )
    speaker_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    # 話者分離（P4-A）ラベル。回放・議事録の話者帰属に用いる（未実行時 null）。
    speaker_label: Mapped[str | None] = mapped_column(String(100), nullable=True)
    seq: Mapped[int | None] = mapped_column(Integer, nullable=True)

    source_language: Mapped[str] = mapped_column(String(10))
    # 暗号化アーカイブ参照（sha256 hex）。音声を保存した場合のみ非 null。
    audio_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)

    # 実時パイプライン出力（回放・diff 用）
    asr_text: Mapped[str] = mapped_column(Text)
    translations: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    tags: Mapped[list | None] = mapped_column(JSON, nullable=True)
    degraded: Mapped[bool] = mapped_column(Boolean, default=False)
    trace_id: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # 離線重跑の状態（既定 pending）
    rerun_status: Mapped[str] = mapped_column(
        String(10), default=RerunStatus.PENDING.value, server_default="pending"
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, index=True
    )

    __table_args__ = (
        # セッション単位で未処理事件を時系列に読むホットパス（重跑ジョブ）。
        Index("ix_pipeline_event_session_status", "session_id", "rerun_status"),
    )


class RerunResult(Base):
    """離線重跑の結果（P3-D）。実時記録を汚さず高品質版を別テーブルへ保存する。

    目的:
        最強モデルによる ASR/MT 再処理結果を保存し、議事録の高品質版・実時出力との
        diff・訓練訂正候補の生成源とする。
    注意点:
        - 実時の TranscriptSegment/TranslationSegment は不変。高品質版はここに分離。
        - diff から生成する訓練訂正は機械出力のため既定 holdout（人手 review 前提）。
    """

    __tablename__ = "rerun_result"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uid)
    pipeline_event_id: Mapped[str] = mapped_column(
        ForeignKey("pipeline_event.id"), index=True
    )
    transcript_segment_id: Mapped[str | None] = mapped_column(
        ForeignKey("transcript_segment.id"), index=True, nullable=True
    )

    source_language: Mapped[str] = mapped_column(String(10))
    asr_text: Mapped[str] = mapped_column(Text)  # 高品質 ASR 再処理結果
    translations: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    # 再処理に用いたモデル（監査・再現用）
    asr_model: Mapped[str | None] = mapped_column(String(50), nullable=True)
    mt_model: Mapped[str | None] = mapped_column(String(50), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now
    )


class ExperimentMetric(Base):
    """A/B 実験の観測指標（改善案 §5.1 / P4-C）。

    目的:
        実験群（variant）ごとの品質/遅延などの観測値を 1 件 1 行で蓄積し、群間比較
        （平均・件数・最小/最大）で優劣を判定する根拠とする。
    注意点:
        - 実験の配信判定は ab_testing.py（純ロジック・決定的）、本テーブルは結果の
          永続層のみ。experiment_key + variant で集計する。
        - 記録失敗はライブを壊さない（app.db.experiments が握る）。
    """

    __tablename__ = "experiment_metric"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uid)
    experiment_key: Mapped[str] = mapped_column(String(100), index=True)
    variant: Mapped[str] = mapped_column(String(50))
    # 配信単位の id（会議/利用者/セッション）。監査・重複排除の手掛かり（任意）。
    unit_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    stage: Mapped[str | None] = mapped_column(String(20), nullable=True)

    metric_name: Mapped[str] = mapped_column(String(50))
    metric_value: Mapped[float] = mapped_column(Float)

    room_id: Mapped[str | None] = mapped_column(
        ForeignKey("rooms.id"), nullable=True
    )
    session_id: Mapped[str | None] = mapped_column(
        ForeignKey("meeting_sessions.id"), nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, index=True
    )

    __table_args__ = (
        # 実験×群で指標を集計するホットパス。
        Index("ix_experiment_metric_key_variant", "experiment_key", "variant"),
    )
