"""音声の暗号化アーカイブストア（P3-D 離線重跑）。

目的:
    プライバシー不変条件（生の音声バイト列は DB に保存せず、sha256 の
    ``audio_hash`` 参照のみを持つ）の実体側。ハッシュが解決する先の、
    AES-GCM で暗号化されたブロブストアを提供する。

入出力:
    - 入力: 生の音声バイト列と、その sha256 hex ハッシュ。
    - 出力: 暗号化ファイル（ディスク上）と、復号済みバイト列。

注意点:
    - ライブパイプラインを壊さないため、保存・削除系は例外を送出せず
      warning ログ + 真偽値で結果を返す。
    - 暗号化鍵はハードコードせず ``settings.audio_archive_key``（base64）
      から取得する。鍵未設定・鍵長不正・crypto 未導入ならアーカイブ無効。
    - ブロッキング I/O と暗号処理は ``asyncio.to_thread`` でイベント
      ループ外へ逃がす（本モジュールの store/load 等は async）。
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import logging
import os
from abc import ABC, abstractmethod
from datetime import datetime
from pathlib import Path

from app.config import settings

logger = logging.getLogger(__name__)

# 名前付き定数（マジックナンバー禁止）
_NONCE_BYTES = 12  # AES-GCM 推奨ノンス長（96 bit）
_AES_KEY_BYTES = 32  # AES-256 の鍵長
_ARCHIVE_SUFFIX = ".enc"  # 暗号化ファイルの拡張子
_HASH_PREFIX_LEN = 2  # サブディレクトリ分割に使うハッシュ先頭文字数


def compute_audio_hash(data: bytes) -> str:
    """生バイト列の sha256 hex ダイジェストを返す純関数。

    入力: data — 音声などの生バイト列。
    出力: 64 文字の小文字 hex 文字列。
    注意点: 副作用なし・決定的。
    """
    return hashlib.sha256(data).hexdigest()


def cryptography_available() -> bool:
    """AESGCM が利用可能かを返す。

    入力: なし。
    出力: cryptography 由来の AESGCM を import できれば True。
    注意点: 未導入環境でも例外を出さないよう遅延 import で判定する。
    """
    try:
        from cryptography.hazmat.primitives.ciphers.aead import (  # noqa: F401
            AESGCM,
        )
    except ImportError:
        return False
    return True


class AudioArchive(ABC):
    """音声アーカイブストアの抽象基底クラス。

    目的: 暗号化ファイル実装や将来の別バックエンドを差し替え可能にする。
    注意点: すべて async メソッド。実装は例外を握りつぶし安全に縮退する。
    """

    @abstractmethod
    async def store(self, audio_hash: str, data: bytes) -> bool:
        """音声バイト列を保存する。成功で True。"""
        raise NotImplementedError

    @abstractmethod
    async def load(self, audio_hash: str) -> bytes | None:
        """ハッシュに対応する音声バイト列を返す。無ければ None。"""
        raise NotImplementedError

    @abstractmethod
    async def exists(self, audio_hash: str) -> bool:
        """ハッシュに対応する音声が存在すれば True。"""
        raise NotImplementedError

    @abstractmethod
    async def delete(self, audio_hash: str) -> bool:
        """ハッシュに対応する音声を削除する。成功/不在で True。"""
        raise NotImplementedError

    @abstractmethod
    async def purge_older_than(self, cutoff: datetime) -> int:
        """cutoff より古い音声を削除し、削除件数を返す。"""
        raise NotImplementedError


class EncryptedFileAudioArchive(AudioArchive):
    """AES-GCM でファイル暗号化する音声アーカイブ実装。

    目的: ``{base_dir}/{hash[:2]}/{hash}.enc`` にノンス + 暗号文を保存する。
    入出力:
        - __init__: base_dir（保存先）と key（32 バイトの生鍵）。
        - 各メソッド: audio_hash（hex）と生/復号バイト列。
    注意点:
        - ファイル内容 = ノンス（先頭 12 バイト）+ AESGCM 暗号文。
        - 鍵長不正・crypto 未導入でも available() が False を返すだけで
          コンストラクタは例外を出さない。
    """

    def __init__(self, base_dir: str, key: bytes) -> None:
        """base_dir と 32 バイトの生鍵で初期化する。"""
        self._base_dir = Path(base_dir)
        self._key = key

    def available(self) -> bool:
        """crypto 導入済みかつ鍵長が正しければ True。"""
        return cryptography_available() and len(self._key) == _AES_KEY_BYTES

    def _path_for(self, audio_hash: str) -> Path:
        """ハッシュから保存パスを組み立てる（純関数的ヘルパー）。"""
        return (
            self._base_dir
            / audio_hash[:_HASH_PREFIX_LEN]
            / f"{audio_hash}{_ARCHIVE_SUFFIX}"
        )

    def _encrypt_to_file(self, path: Path, data: bytes) -> None:
        """ノンス + 暗号文を path へ書き込む（ブロッキング）。"""
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM

        nonce = os.urandom(_NONCE_BYTES)
        ciphertext = AESGCM(self._key).encrypt(nonce, data, None)
        path.parent.mkdir(parents=True, exist_ok=True)
        # 一時ファイルへ書いて置換し、途中中断による半端ファイルを避ける
        tmp_path = path.with_suffix(path.suffix + ".tmp")
        tmp_path.write_bytes(nonce + ciphertext)
        tmp_path.replace(path)

    def _decrypt_from_file(self, path: Path) -> bytes:
        """path のノンス + 暗号文を復号して返す（ブロッキング）。"""
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM

        blob = path.read_bytes()
        nonce, ciphertext = blob[:_NONCE_BYTES], blob[_NONCE_BYTES:]
        return AESGCM(self._key).decrypt(nonce, ciphertext, None)

    async def store(self, audio_hash: str, data: bytes) -> bool:
        """音声を暗号化保存する。冪等（既存なら再書込せず True）。"""
        if not self.available():
            return False
        try:
            path = self._path_for(audio_hash)
            if path.exists():
                return True  # 冪等: 既存はそのまま
            await asyncio.to_thread(self._encrypt_to_file, path, data)
        except Exception:  # noqa: BLE001 — ライブパイプラインを壊さない
            logger.warning("音声アーカイブ保存に失敗: %s", audio_hash, exc_info=True)
            return False
        return True

    async def load(self, audio_hash: str) -> bytes | None:
        """音声を復号して返す。不在・復号失敗なら None。"""
        if not self.available():
            return None
        path = self._path_for(audio_hash)
        if not path.exists():
            return None
        try:
            return await asyncio.to_thread(self._decrypt_from_file, path)
        except Exception:  # noqa: BLE001 — 破損ファイル等でも安全に None
            logger.warning("音声アーカイブ復号に失敗: %s", audio_hash, exc_info=True)
            return None

    async def exists(self, audio_hash: str) -> bool:
        """暗号化ファイルが存在すれば True。"""
        return await asyncio.to_thread(self._path_for(audio_hash).exists)

    async def delete(self, audio_hash: str) -> bool:
        """音声を削除する。成功/不在で True、エラー時のみ False。"""
        try:
            path = self._path_for(audio_hash)
            await asyncio.to_thread(path.unlink, True)  # missing_ok=True
        except Exception:  # noqa: BLE001 — 削除失敗でも縮退
            logger.warning("音声アーカイブ削除に失敗: %s", audio_hash, exc_info=True)
            return False
        return True

    async def purge_older_than(self, cutoff: datetime) -> int:
        """cutoff より mtime が古い .enc を削除し件数を返す。"""
        return await asyncio.to_thread(self._purge_older_than_sync, cutoff)

    def _purge_older_than_sync(self, cutoff: datetime) -> int:
        """purge の同期実体（ブロッキング）。ディレクトリ不在でも 0。"""
        if not self._base_dir.exists():
            return 0
        cutoff_ts = cutoff.timestamp()
        deleted = 0
        for path in self._base_dir.rglob(f"*{_ARCHIVE_SUFFIX}"):
            try:
                if path.stat().st_mtime < cutoff_ts:
                    path.unlink()
                    deleted += 1
            except OSError:
                logger.warning("purge 中の削除に失敗: %s", path, exc_info=True)
        logger.info("音声アーカイブ purge 完了: %d 件削除", deleted)
        return deleted


def build_audio_archive() -> AudioArchive | None:
    """settings から音声アーカイブを構築する。

    入力: なし（``app.config.settings`` を参照）。
    出力: 有効時は EncryptedFileAudioArchive、無効時は None。
    注意点:
        以下のいずれかで None を返す（アーカイブ無効化）:
        enable_audio_archive が False / 鍵未設定 / crypto 未導入 /
        base64 デコード失敗 / 鍵長が 32 バイトでない。
    """
    if not settings.enable_audio_archive:
        return None
    if not settings.audio_archive_key:
        return None
    if not cryptography_available():
        logger.warning("cryptography 未導入のため音声アーカイブを無効化")
        return None
    try:
        key = base64.b64decode(settings.audio_archive_key, validate=True)
    except (ValueError, TypeError):
        logger.warning("audio_archive_key の base64 デコードに失敗。アーカイブ無効")
        return None
    if len(key) != _AES_KEY_BYTES:
        logger.warning("audio_archive_key の鍵長が不正（32 バイト必須）。アーカイブ無効")
        return None
    return EncryptedFileAudioArchive(settings.audio_archive_dir, key)
