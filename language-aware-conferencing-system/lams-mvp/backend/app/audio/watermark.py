"""
合成音の provenance マーカー（P4-B、§4.4 watermark_required）。

目的:
    TTS 合成 WAV を「機械生成である」と機械可読に明示し、合成音の出所追跡を
    可能にする。WAV(RIFF) はチャンク形式で、未知チャンクはプレイヤーに無視される
    ため、独自チャンク `LAMS` にマーカー文字列を埋め込んでも再生に影響しない。

入出力:
    いずれも WAV バイト列（16-bit PCM mono を想定）を受け取り、
    apply_watermark は新しい WAV バイト列を、is_watermarked は bool を、
    read_watermark は marker 文字列または None を返す。

注意点（重要・正直な限界）:
    これは「出所開示（provenance/disclosure）マーカー」であり、改ざん耐性や
    除去耐性を持つ耐タンパー透かしではない。RIFF チャンクは容易に剥がせるため、
    悪意ある第三者による除去・偽装は防げない。あくまで正規経路での出所表示が
    目的であり、敵対的な悪用防止は保証しない。
"""

import logging
import struct

logger = logging.getLogger(__name__)

_DEFAULT_MARKER = "LAMS-SYNTH"  # provenance marker payload（既定の埋め込み文字列）
_WATERMARK_CHUNK_ID = b"LAMS"  # custom RIFF chunk id（4 バイト固定）

# RIFF 構造のオフセット・サイズ定数（マジックナンバー回避）。
_RIFF_HEADER_SIZE = 12  # "RIFF" + size(4) + "WAVE"
_CHUNK_HEADER_SIZE = 8  # chunk id(4) + little-endian size(4)
_RIFF_SIZE_OFFSET = 4  # bytes[4:8] = RIFF 全体サイズ（= 全体長 - 8）
_RIFF_ID = b"RIFF"
_WAVE_ID = b"WAVE"
_MARKER_ENCODING = "utf-8"


def _iter_chunks(wav: bytes):
    """RIFF/WAVE のチャンクを (id, payload) で順に返すジェネレータ。

    目的: apply/is/read から共通のチャンク走査を再利用する。
    注意点: 正当な RIFF/WAVE でない、または途中で切り詰められている場合は
            何も yield せず打ち切る（例外は投げない）。
    """
    if (
        len(wav) < _RIFF_HEADER_SIZE
        or wav[0:4] != _RIFF_ID
        or wav[8:12] != _WAVE_ID
    ):
        return
    offset = _RIFF_HEADER_SIZE
    total = len(wav)
    while offset + _CHUNK_HEADER_SIZE <= total:
        chunk_id = wav[offset : offset + 4]
        (size,) = struct.unpack_from("<I", wav, offset + 4)
        payload_start = offset + _CHUNK_HEADER_SIZE
        payload_end = payload_start + size
        if payload_end > total:
            # サイズ宣言が実データを超える（破損）→ 走査を打ち切る。
            return
        yield chunk_id, wav[payload_start:payload_end]
        # RIFF チャンクは偶数境界にパディングされる（奇数長なら +1）。
        offset = payload_end + (size & 1)


def read_watermark(wav: bytes) -> str | None:
    """埋め込まれた marker 文字列を返す（無ければ None、解析不能なら None）。

    Args:
        wav: 解析対象の WAV バイト列。
    Returns:
        最初に見つかった LAMS チャンクの marker 文字列。無ければ None。
    """
    try:
        for chunk_id, payload in _iter_chunks(wav):
            if chunk_id == _WATERMARK_CHUNK_ID:
                return payload.rstrip(b"\x00").decode(_MARKER_ENCODING)
    except (struct.error, UnicodeDecodeError, ValueError):
        return None
    return None


def is_watermarked(wav: bytes, marker: str = _DEFAULT_MARKER) -> bool:
    """WAV に指定 marker の LAMS チャンクが在るか（解析不能なら False）。

    Args:
        wav: 解析対象の WAV バイト列。
        marker: 照合するマーカー文字列。
    Returns:
        指定マーカーが埋め込まれていれば True、それ以外は False。
    """
    return read_watermark(wav) == marker


def _build_chunk(marker: str) -> bytes:
    """marker から LAMS チャンク（id + size + payload + 必要ならパディング）を作る。"""
    payload = marker.encode(_MARKER_ENCODING)
    chunk = _WATERMARK_CHUNK_ID + struct.pack("<I", len(payload)) + payload
    if len(payload) & 1:
        chunk += b"\x00"  # 偶数境界へパディング。
    return chunk


def apply_watermark(wav: bytes, marker: str = _DEFAULT_MARKER) -> bytes:
    """WAV に provenance マーカーチャンクを埋め込んだ新しい WAV を返す。

    入力が正当な RIFF/WAVE でない、または失敗時は入力をそのまま返す
    （合成音配信を止めない）。既に同一 marker 付きなら冪等に入力を返す。

    Args:
        wav: 元の WAV バイト列（16-bit PCM mono 想定）。
        marker: 埋め込むマーカー文字列。
    Returns:
        マーカーチャンクを末尾に追加した WAV バイト列（失敗時は元の wav）。
    """
    try:
        if is_watermarked(wav, marker):
            return wav  # 冪等: 同一マーカーは再付与しない。
        if (
            len(wav) < _RIFF_HEADER_SIZE
            or wav[0:4] != _RIFF_ID
            or wav[8:12] != _WAVE_ID
        ):
            logger.warning("watermark: 非 RIFF/WAVE 入力のためスキップします")
            return wav
        chunk = _build_chunk(marker)
        (riff_size,) = struct.unpack_from("<I", wav, _RIFF_SIZE_OFFSET)
        new_size = riff_size + len(chunk)
        head = wav[:_RIFF_SIZE_OFFSET] + struct.pack("<I", new_size)
        return head + wav[_RIFF_HEADER_SIZE - 4 :] + chunk
    except (struct.error, UnicodeError, ValueError) as exc:
        logger.warning("watermark: 付与に失敗したため元の WAV を返します: %s", exc)
        return wav
