"""
LAMS 話者識別＋会議内クラスタリング（P4-A）

目的:
- 1発話分の音声埋め込み（voice embedding）から話者ラベルを推定する。
- 同意登録済みの話者（P3-C SpeakerEnrollment）と余弦類似度で照合し、
  一致すれば登録ユーザーを紐付ける。
- 一致しなければ会議内でクラスタリングし、匿名話者
  "Speaker 1", "Speaker 2", ... を割り当てる。

入出力:
- 入力: room_id、embedding（Sequence[float] | None）、enrollments。
- 出力: SpeakerIdentity（user_id / 表示ラベル / 類似度 / 一致フラグ）。

注意点:
- 本モジュールは純ロジックのみ。音声・DB・MLライブラリへ依存しない。
- LiveKit トラック権限としての speaker_id は別所で扱う。ここは
  「エンハンスメント用ラベル」と任意の一致 user_id のみを生成する。
- 会議終了時は forget_room を呼びクラスタ状態の漏えいを防ぐ
  （app/webrtc/persistence.py の SubtitleSequencer.forget_room に倣う）。
"""

import logging
from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np

logger = logging.getLogger(__name__)

# === 既定閾値・ラベル定数（マジックナンバー回避） ===
_DEFAULT_MATCH_THRESHOLD = 0.75  # 登録話者一致とみなす最小余弦類似度
_DEFAULT_CLUSTER_THRESHOLD = 0.70  # 同一匿名クラスタとみなす最小余弦類似度
_UNKNOWN_LABEL = "Speaker ?"  # embedding 無し時の表示ラベル
_ANON_LABEL_PREFIX = "Speaker "  # 会議内クラスタの接頭辞（"Speaker 1" ...）
_ZERO_SCORE = 0.0  # 類似度なし・未知時の既定スコア


@dataclass(frozen=True)
class Enrollment:
    """
    同意登録済み話者の埋め込み。

    目的: 登録話者との照合入力を表す不変値。
    - user_id: 登録ユーザーID。
    - speaker_label: 表示名（例: "Alice"）。
    - embedding: 声紋埋め込みベクトル。
    """

    user_id: str
    speaker_label: str
    embedding: tuple[float, ...] | list[float]


@dataclass(frozen=True)
class SpeakerIdentity:
    """
    話者識別結果。

    目的: identify の出力を表す不変値。
    - user_id: 登録話者一致時のユーザーID、未登録は None。
    - label: 表示ラベル（登録名 / "Speaker N" / "Speaker ?"）。
    - score: 最良類似度（0.0-1.0 目安）。
    - matched: True=登録話者一致 / False=匿名クラスタ or 不明。
    """

    user_id: str | None
    label: str
    score: float
    matched: bool


@dataclass
class _Cluster:
    """
    会議内匿名クラスタの内部状態（可変）。

    目的: 重心の移動平均更新を保持する。
    - centroid: 重心ベクトル（np.ndarray）。
    - count: 取り込んだ発話数。
    - label: 割り当て済み表示ラベル。
    """

    centroid: np.ndarray
    count: int
    label: str


def cosine_similarity(a: Sequence[float], b: Sequence[float]) -> float:
    """
    余弦類似度を計算する純関数。

    目的: 2ベクトルの向きの近さ（-1.0〜1.0）を返す。
    入出力:
    - 入力: a, b（数値シーケンス）。
    - 出力: 余弦類似度。いずれかが零ベクトル/空/長さ不一致なら 0.0。
    注意点: 副作用なし。内部で float 配列へ変換する。
    """
    if len(a) == 0 or len(b) == 0 or len(a) != len(b):
        return _ZERO_SCORE
    vec_a = np.asarray(a, dtype=float)
    vec_b = np.asarray(b, dtype=float)
    norm_a = float(np.linalg.norm(vec_a))
    norm_b = float(np.linalg.norm(vec_b))
    if norm_a == 0.0 or norm_b == 0.0:
        return _ZERO_SCORE
    return float(np.dot(vec_a, vec_b) / (norm_a * norm_b))


class SpeakerIdentifier:
    """
    話者識別＋会議内クラスタリングの本体。

    目的: 登録話者照合と会議内匿名クラスタリングを行う。
    注意点:
    - クラスタ状態は部屋ごとに保持し、forget_room で破棄する。
    - スレッド安全性は前提としない（呼び出し側で直列化する想定）。
    """

    def __init__(
        self,
        *,
        match_threshold: float = _DEFAULT_MATCH_THRESHOLD,
        cluster_threshold: float = _DEFAULT_CLUSTER_THRESHOLD,
    ) -> None:
        """
        目的: 閾値を設定し内部状態を初期化する。
        入出力:
        - match_threshold: 登録話者一致とみなす最小類似度。
        - cluster_threshold: 同一匿名クラスタとみなす最小類似度。
        """
        self._match_threshold = match_threshold
        self._cluster_threshold = cluster_threshold
        self._rooms: dict[str, list[_Cluster]] = {}

    def identify(
        self,
        room_id: str,
        embedding: Sequence[float] | None,
        enrollments: Sequence[Enrollment],
    ) -> SpeakerIdentity:
        """
        目的: 1発話分の埋め込みから話者を識別する。
        入出力:
        - room_id: 会議室ID（クラスタ状態の分離キー）。
        - embedding: 声紋埋め込み。None/空なら未知を返す。
        - enrollments: 同意登録済み話者一覧。
        - 出力: SpeakerIdentity。
        注意点:
        - embedding 無し時はクラスタを作らない。
        - 登録一致時はクラスタ状態を変更しない（決定的挙動）。
        """
        if embedding is None or len(embedding) == 0:
            return SpeakerIdentity(None, _UNKNOWN_LABEL, _ZERO_SCORE, False)

        vec = np.asarray(embedding, dtype=float)

        # 1. 登録話者照合
        matched = self._match_enrollment(vec, enrollments)
        if matched is not None:
            return matched

        # 2. 会議内クラスタリング
        return self._cluster(room_id, vec)

    def _match_enrollment(
        self, vec: np.ndarray, enrollments: Sequence[Enrollment]
    ) -> SpeakerIdentity | None:
        """
        目的: 登録話者との最良一致を評価する。
        入出力:
        - vec: 照合対象の埋め込み。
        - enrollments: 登録話者一覧。
        - 出力: 閾値以上で一致すれば SpeakerIdentity、なければ None。
        注意点: クラスタ状態は変更しない。
        """
        best_score = _ZERO_SCORE
        best: Enrollment | None = None
        for enroll in enrollments:
            score = cosine_similarity(vec, enroll.embedding)
            if score > best_score:
                best_score = score
                best = enroll
        if best is not None and best_score >= self._match_threshold:
            return SpeakerIdentity(best.user_id, best.speaker_label, best_score, True)
        return None

    def _cluster(self, room_id: str, vec: np.ndarray) -> SpeakerIdentity:
        """
        目的: 会議内の匿名クラスタへ割り当てる（無ければ新規作成）。
        入出力:
        - room_id: 会議室ID。
        - vec: 割り当て対象の埋め込み。
        - 出力: SpeakerIdentity（matched=False, user_id=None）。
        注意点: 一致時は重心を移動平均で更新する。
        """
        clusters = self._rooms.setdefault(room_id, [])

        best_score = _ZERO_SCORE
        best: _Cluster | None = None
        for cluster in clusters:
            score = cosine_similarity(vec, cluster.centroid)
            if score > best_score:
                best_score = score
                best = cluster

        if best is not None and best_score >= self._cluster_threshold:
            # 既存クラスタへ取り込み、重心を移動平均で更新する
            best.centroid = (best.centroid * best.count + vec) / (best.count + 1)
            best.count += 1
            return SpeakerIdentity(None, best.label, best_score, False)

        # 新規クラスタ生成
        new_label = f"{_ANON_LABEL_PREFIX}{len(clusters) + 1}"
        clusters.append(_Cluster(centroid=vec, count=1, label=new_label))
        return SpeakerIdentity(None, new_label, best_score, False)

    def forget_room(self, room_id: str) -> None:
        """
        目的: 会議終了時に部屋のクラスタ状態を破棄する。
        入出力:
        - room_id: 会議室ID。
        - 出力: なし。
        注意点: 未知の room_id でも例外を投げない（冪等）。
        """
        self._rooms.pop(room_id, None)
