"""暫定字幕 revision の単一権威（RevisionAuthority）。

公開 lifecycle は begin／advance／finalize／release。
room・speaker・utterance・stream key ごとの単調増加を所有し、
確定後の遅延 interim と退室後の残留 state を防ぐ。
本文テキストは保持しない。採番値は event 契約の revision へそのまま載せる前提。
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from enum import Enum


class StreamKind(str, Enum):
    """暫定字幕 stream の種別。

    partial ASR と hearing transcript delta の共有／分離を key で明示する。
    同じ RevisionStreamKey を渡せば単一の単調列を共有し、
    種別や language が異なれば独立する。
    """

    PARTIAL_ASR = "partial_asr"
    HEARING_TRANSCRIPT = "hearing_transcript"


@dataclass(frozen=True)
class RevisionStreamKey:
    """字幕 stream を一意に識別する key。

    入力:
        kind: producer 種別（partial ASR / hearing transcript 等）。
        language: 目標言語など。不要なら空文字。
    """

    kind: StreamKind
    language: str = ""

    def wire(self) -> str:
        """内部辞書用の安定した文字列表現を返す。"""
        if self.language:
            return f"{self.kind.value}:{self.language}"
        return self.kind.value


@dataclass(frozen=True)
class RevisionToken:
    """authority が発行する暫定字幕 revision token。

    Output Manager／event builder は revision を再採番せず、
    この値を wire event の revision フィールドへ保持する。
    """

    room_id: str
    speaker_id: str
    utterance_id: str
    stream_key: RevisionStreamKey
    revision: int


@dataclass(frozen=True)
class RevisionAuthoritySnapshot:
    """本文なしの state 観測用スナップショット。"""

    room_count: int
    speaker_count: int
    utterance_count: int
    stream_count: int
    finalized_stream_count: int


class RevisionAuthorityError(ValueError):
    """RevisionAuthority 操作の基底例外。"""


class RevisionUnknownError(RevisionAuthorityError):
    """begin されていない utterance／解放済み stream への操作。"""


class RevisionFinalizedError(RevisionAuthorityError):
    """finalize 済み stream への advance。"""


@dataclass
class _StreamState:
    """単一 stream の採番状態（本文は持たない）。"""

    revision: int = 0
    finalized: bool = False


class RevisionAuthority:
    """暫定字幕 revision の発行・比較・終了を一箇所で所有する権威。"""

    def __init__(self) -> None:
        # (room_id, speaker_id, utterance_id, stream_wire) -> state
        self._streams: dict[tuple[str, str, str, str], _StreamState] = {}
        # begin 済み utterance の集合（stream 未作成でも identity を保持）
        self._utterances: set[tuple[str, str, str]] = set()

    def begin(
        self,
        room_id: str,
        speaker_id: str,
        *,
        utterance_id: str | None = None,
    ) -> str:
        """発話開始時に安定した utterance identity を割り当てる。

        入力:
            room_id / speaker_id: 会議と話者。
            utterance_id: 呼び出し側の候補。空または None なら新規発行する。
        出力:
            恒久 key として使える非空の utterance_id。
        注意:
            空の temporary subtitle id は恒久 key にしない。
        """
        if utterance_id is None or utterance_id.strip() == "":
            assigned = str(uuid.uuid4())
        else:
            assigned = utterance_id
        self._utterances.add((room_id, speaker_id, assigned))
        return assigned

    def advance(
        self,
        room_id: str,
        speaker_id: str,
        utterance_id: str,
        stream_key: RevisionStreamKey,
    ) -> RevisionToken:
        """対象 stream の revision を 1 進め、発行 token を返す。

        入力:
            room_id / speaker_id / utterance_id / stream_key: 対象 stream。
        出力:
            単調増加した revision を持つ RevisionToken。
        例外:
            RevisionUnknownError: begin 前または release 済み。
            RevisionFinalizedError: finalize 後の遅延 advance。
        """
        utterance = (room_id, speaker_id, utterance_id)
        if utterance not in self._utterances:
            raise RevisionUnknownError(
                f"未知の utterance です: room={room_id} speaker={speaker_id} "
                f"utterance={utterance_id}"
            )
        key = self._stream_lookup(room_id, speaker_id, utterance_id, stream_key)
        state = self._streams.get(key)
        if state is None:
            state = _StreamState()
            self._streams[key] = state
        if state.finalized:
            raise RevisionFinalizedError(
                f"finalize 済み stream です: {stream_key.wire()}"
            )
        state.revision += 1
        return RevisionToken(
            room_id=room_id,
            speaker_id=speaker_id,
            utterance_id=utterance_id,
            stream_key=stream_key,
            revision=state.revision,
        )

    def finalize(
        self,
        room_id: str,
        speaker_id: str,
        utterance_id: str,
        stream_key: RevisionStreamKey | None = None,
    ) -> None:
        """対象 stream（または発話内全 stream）を確定し、以後の advance を無効化する。

        入力:
            stream_key: 指定時はその stream のみ。None なら当該 utterance の全 stream。
        注意:
            未作成の stream を finalize する場合は tombstone を残し、遅延 advance を拒否する。
        """
        utterance = (room_id, speaker_id, utterance_id)
        if utterance not in self._utterances:
            raise RevisionUnknownError(
                f"未知の utterance です: room={room_id} speaker={speaker_id} "
                f"utterance={utterance_id}"
            )
        if stream_key is not None:
            key = self._stream_lookup(room_id, speaker_id, utterance_id, stream_key)
            state = self._streams.get(key)
            if state is None:
                state = _StreamState()
                self._streams[key] = state
            state.finalized = True
            return
        prefix = (room_id, speaker_id, utterance_id)
        for key, state in self._streams.items():
            if key[:3] == prefix:
                state.finalized = True

    def accept(self, token: RevisionToken) -> bool:
        """配信前に token がまだ有効かを判定する。

        最新 revision と一致し、かつ finalize／release されていない場合のみ True。
        古い token・確定済み・未知 stream は False（遅延 interim 拒否）。
        """
        utterance = (token.room_id, token.speaker_id, token.utterance_id)
        if utterance not in self._utterances:
            return False
        key = self._stream_lookup(
            token.room_id, token.speaker_id, token.utterance_id, token.stream_key
        )
        state = self._streams.get(key)
        if state is None or state.finalized:
            return False
        return token.revision == state.revision

    def release_utterance(
        self, room_id: str, speaker_id: str, utterance_id: str
    ) -> None:
        """発話の cancel／終了で当該 utterance の state を解放する。"""
        self._utterances.discard((room_id, speaker_id, utterance_id))
        prefix = (room_id, speaker_id, utterance_id)
        for key in [k for k in self._streams if k[:3] == prefix]:
            del self._streams[key]

    def release_speaker(self, room_id: str, speaker_id: str) -> None:
        """参加者退室時に当該話者の revision state をすべて解放する。"""
        self._utterances = {
            key
            for key in self._utterances
            if not (key[0] == room_id and key[1] == speaker_id)
        }
        for key in [k for k in self._streams if k[0] == room_id and k[1] == speaker_id]:
            del self._streams[key]

    def release_room(self, room_id: str) -> None:
        """room 終了時に当該会議室の revision state をすべて解放する。"""
        self._utterances = {key for key in self._utterances if key[0] != room_id}
        for key in [k for k in self._streams if k[0] == room_id]:
            del self._streams[key]

    def snapshot(self) -> RevisionAuthoritySnapshot:
        """本文なしで残留 state 数を返す（cleanup 漏れ観測用）。"""
        rooms = {key[0] for key in self._utterances} | {k[0] for k in self._streams}
        speakers = {(key[0], key[1]) for key in self._utterances} | {
            (k[0], k[1]) for k in self._streams
        }
        utterances = set(self._utterances) | {(k[0], k[1], k[2]) for k in self._streams}
        finalized = sum(1 for state in self._streams.values() if state.finalized)
        return RevisionAuthoritySnapshot(
            room_count=len(rooms),
            speaker_count=len(speakers),
            utterance_count=len(utterances),
            stream_count=len(self._streams),
            finalized_stream_count=finalized,
        )

    @staticmethod
    def _stream_lookup(
        room_id: str,
        speaker_id: str,
        utterance_id: str,
        stream_key: RevisionStreamKey,
    ) -> tuple[str, str, str, str]:
        """内部辞書の lookup key を組み立てる。"""
        return (room_id, speaker_id, utterance_id, stream_key.wire())


# プロセス既定の共有権威（Ingress と Runtime が同一インスタンスを参照する）
_default_revision_authority: RevisionAuthority | None = None


def get_revision_authority() -> RevisionAuthority:
    """プロセス共有の RevisionAuthority を返す（未作成なら生成する）。"""
    global _default_revision_authority
    if _default_revision_authority is None:
        _default_revision_authority = RevisionAuthority()
    return _default_revision_authority


def reset_revision_authority_for_tests() -> RevisionAuthority:
    """テスト用に既定権威を新品へ差し替え、そのインスタンスを返す。"""
    global _default_revision_authority
    _default_revision_authority = RevisionAuthority()
    return _default_revision_authority
