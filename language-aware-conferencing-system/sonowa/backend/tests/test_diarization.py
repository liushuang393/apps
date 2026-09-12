"""
話者識別＋会議内クラスタリング（diarization）のユニットテスト

目的:
- cosine_similarity の純関数としての正当性を検証する。
- SpeakerIdentifier の登録話者一致・匿名クラスタリング・部屋分離・
  状態破棄・重心移動平均の各挙動を検証する。

注意点:
- 低次元ベクトルを用いて余弦類似度を人手でも確認可能にする。
"""

import pytest

from app.ai_pipeline.diarization import (
    Enrollment,
    SpeakerIdentifier,
    cosine_similarity,
)

# テスト用の許容誤差（浮動小数比較）
_TOL = 1e-6


class TestCosineSimilarity:
    """cosine_similarity 純関数の検証。"""

    def test_identical_vectors(self) -> None:
        assert cosine_similarity([1.0, 2.0, 3.0], [1.0, 2.0, 3.0]) == pytest.approx(
            1.0, abs=_TOL
        )

    def test_orthogonal_vectors(self) -> None:
        assert cosine_similarity([1.0, 0.0], [0.0, 1.0]) == pytest.approx(0.0, abs=_TOL)

    def test_zero_vector(self) -> None:
        assert cosine_similarity([0.0, 0.0], [1.0, 2.0]) == 0.0

    def test_length_mismatch(self) -> None:
        assert cosine_similarity([1.0, 0.0], [1.0, 0.0, 0.0]) == 0.0

    def test_empty_vector(self) -> None:
        assert cosine_similarity([], [1.0]) == 0.0

    def test_opposite_vectors(self) -> None:
        assert cosine_similarity([1.0, 0.0], [-1.0, 0.0]) == pytest.approx(
            -1.0, abs=_TOL
        )


class TestIdentifyNoEmbedding:
    """embedding 無し時の挙動（クラスタを作らないこと）。"""

    def test_none_embedding_returns_unknown(self) -> None:
        ident = SpeakerIdentifier()
        result = ident.identify("room", None, [])
        assert result.user_id is None
        assert result.label == "Speaker ?"
        assert result.score == 0.0
        assert result.matched is False

    def test_empty_embedding_returns_unknown(self) -> None:
        ident = SpeakerIdentifier()
        result = ident.identify("room", [], [])
        assert result.label == "Speaker ?"
        assert result.matched is False

    def test_no_cluster_created_after_unknown(self) -> None:
        """未知応答後も番号は消費されず、次の実ベクトルが Speaker 1 になる。"""
        ident = SpeakerIdentifier()
        ident.identify("room", None, [])
        result = ident.identify("room", [1.0, 0.0], [])
        assert result.label == "Speaker 1"


class TestRegisteredMatch:
    """登録話者一致の検証。"""

    def test_matches_enrollment(self) -> None:
        ident = SpeakerIdentifier()
        enrollments = [
            Enrollment(user_id="u1", speaker_label="Alice", embedding=[1.0, 0.0, 0.0])
        ]
        result = ident.identify("room", [0.99, 0.01, 0.0], enrollments)
        assert result.matched is True
        assert result.user_id == "u1"
        assert result.label == "Alice"
        assert result.score >= 0.75

    def test_registered_match_does_not_create_cluster(self) -> None:
        ident = SpeakerIdentifier()
        enrollments = [
            Enrollment(user_id="u1", speaker_label="Alice", embedding=[1.0, 0.0, 0.0])
        ]
        ident.identify("room", [0.99, 0.01, 0.0], enrollments)
        # 登録一致はクラスタ状態を変えない → 別ベクトルが Speaker 1 になる
        result = ident.identify("room", [0.0, 1.0, 0.0], [])
        assert result.label == "Speaker 1"


class TestAnonymousClustering:
    """匿名クラスタリングの検証。"""

    def test_first_speaker_creates_cluster_one(self) -> None:
        ident = SpeakerIdentifier()
        result = ident.identify("room", [1.0, 0.0], [])
        assert result.label == "Speaker 1"
        assert result.matched is False
        assert result.user_id is None
        assert result.score == 0.0

    def test_similar_query_joins_same_cluster(self) -> None:
        ident = SpeakerIdentifier()
        ident.identify("room", [1.0, 0.0], [])
        result = ident.identify("room", [0.98, 0.02], [])
        assert result.label == "Speaker 1"

    def test_dissimilar_query_creates_new_cluster(self) -> None:
        ident = SpeakerIdentifier()
        ident.identify("room", [1.0, 0.0], [])
        ident.identify("room", [0.98, 0.02], [])
        result = ident.identify("room", [0.0, 1.0], [])
        assert result.label == "Speaker 2"


class TestBelowMatchThresholdFallsToClustering:
    """一致閾値未満の登録話者はクラスタリングへフォールスルーする。"""

    def test_between_thresholds_falls_through(self) -> None:
        # match=0.75, cluster=0.70。cosine≈0.7071 は両閾値の間にある。
        ident = SpeakerIdentifier()
        enrollments = [
            Enrollment(user_id="u1", speaker_label="Alice", embedding=[1.0, 0.0])
        ]
        result = ident.identify("room", [1.0, 1.0], enrollments)
        assert result.matched is False
        assert result.user_id is None
        assert result.label == "Speaker 1"


class TestRoomIsolation:
    """部屋ごとにクラスタ番号が独立していること。"""

    def test_rooms_are_independent(self) -> None:
        ident = SpeakerIdentifier()
        assert ident.identify("A", [1.0, 0.0], []).label == "Speaker 1"
        assert ident.identify("A", [0.0, 1.0], []).label == "Speaker 2"
        # 別部屋は Speaker 1 から再開
        assert ident.identify("B", [0.0, 1.0], []).label == "Speaker 1"


class TestForgetRoom:
    """forget_room による状態破棄。"""

    def test_forget_resets_numbering(self) -> None:
        ident = SpeakerIdentifier()
        ident.identify("room", [1.0, 0.0], [])
        ident.identify("room", [0.0, 1.0], [])
        ident.forget_room("room")
        result = ident.identify("room", [0.0, 1.0], [])
        assert result.label == "Speaker 1"

    def test_forget_unknown_room_is_safe(self) -> None:
        ident = SpeakerIdentifier()
        # 未知の部屋を破棄しても例外を投げない
        ident.forget_room("never-seen")


class TestCentroidRunningMean:
    """重心の移動平均更新の検証。"""

    def test_three_similar_one_different(self) -> None:
        ident = SpeakerIdentifier()
        assert ident.identify("room", [1.0, 0.0], []).label == "Speaker 1"
        assert ident.identify("room", [0.98, 0.02], []).label == "Speaker 1"
        assert ident.identify("room", [0.96, 0.04], []).label == "Speaker 1"
        # 明確に異なるベクトルは第2クラスタ
        assert ident.identify("room", [0.0, 1.0], []).label == "Speaker 2"
