"""音声暗号化アーカイブ（app.audio.archive）のテスト。

目的: ハッシュ計算・暗号化保存/復号・冪等性・存在/削除・purge・鍵検証・
      build_audio_archive の縮退挙動を検証する。
注意点: async テストは @pytest.mark.asyncio を付与（asyncio_mode=strict）。
"""

import os
from datetime import datetime, timedelta, timezone

import pytest

from app.audio import archive as archive_mod
from app.audio.archive import (
    EncryptedFileAudioArchive,
    build_audio_archive,
    compute_audio_hash,
)

# テスト用定数
_SAMPLE = b"\x01\x02\x03 hello audio bytes \xfe\xff"
_KEY_LEN = 32
_HEX_LEN = 64


def _archive(tmp_path) -> EncryptedFileAudioArchive:
    """有効な 32 バイト鍵でアーカイブを生成するヘルパー。"""
    return EncryptedFileAudioArchive(str(tmp_path), os.urandom(_KEY_LEN))


# 1. compute_audio_hash: 決定的・64 桁 hex・別データで別ハッシュ
def test_compute_audio_hash_deterministic_and_hex():
    h1 = compute_audio_hash(_SAMPLE)
    h2 = compute_audio_hash(_SAMPLE)
    assert h1 == h2
    assert len(h1) == _HEX_LEN
    assert all(c in "0123456789abcdef" for c in h1)
    assert compute_audio_hash(b"other") != h1


# 2. store -> load ラウンドトリップ + ディスク上は暗号化されている
@pytest.mark.asyncio
async def test_store_load_roundtrip_encrypted_at_rest(tmp_path):
    arc = _archive(tmp_path)
    h = compute_audio_hash(_SAMPLE)
    assert await arc.store(h, _SAMPLE) is True
    assert await arc.load(h) == _SAMPLE

    enc_path = tmp_path / h[:2] / f"{h}.enc"
    assert enc_path.exists()
    on_disk = enc_path.read_bytes()
    assert on_disk != _SAMPLE  # 平文であってはならない
    assert _SAMPLE not in on_disk


# 3. 未知ハッシュの load は None
@pytest.mark.asyncio
async def test_load_unknown_returns_none(tmp_path):
    arc = _archive(tmp_path)
    assert await arc.load(compute_audio_hash(b"missing")) is None


# 4. store は冪等（2 回目も True・ファイル不変）
@pytest.mark.asyncio
async def test_store_idempotent(tmp_path):
    arc = _archive(tmp_path)
    h = compute_audio_hash(_SAMPLE)
    assert await arc.store(h, _SAMPLE) is True
    enc_path = tmp_path / h[:2] / f"{h}.enc"
    first = enc_path.read_bytes()
    assert await arc.store(h, _SAMPLE) is True
    assert enc_path.read_bytes() == first  # 再書込されていない


# 5. exists は store 前 False / 後 True / delete 後 False
@pytest.mark.asyncio
async def test_exists_lifecycle(tmp_path):
    arc = _archive(tmp_path)
    h = compute_audio_hash(_SAMPLE)
    assert await arc.exists(h) is False
    await arc.store(h, _SAMPLE)
    assert await arc.exists(h) is True
    await arc.delete(h)
    assert await arc.exists(h) is False


# 6. delete はファイル削除・不在でも True
@pytest.mark.asyncio
async def test_delete_removes_and_absent_ok(tmp_path):
    arc = _archive(tmp_path)
    h = compute_audio_hash(_SAMPLE)
    await arc.store(h, _SAMPLE)
    assert await arc.delete(h) is True
    assert await arc.exists(h) is False
    # 既に不在でも True
    assert await arc.delete(h) is True


# 7. purge_older_than: 未来 cutoff で削除、過去 cutoff で非削除
@pytest.mark.asyncio
async def test_purge_older_than(tmp_path):
    arc = _archive(tmp_path)
    h = compute_audio_hash(_SAMPLE)
    await arc.store(h, _SAMPLE)

    past = datetime.now(timezone.utc) - timedelta(days=1)
    assert await arc.purge_older_than(past) == 0  # まだ古くない
    assert await arc.exists(h) is True

    future = datetime.now(timezone.utc) + timedelta(days=1)
    assert await arc.purge_older_than(future) == 1  # すべて古い扱い
    assert await arc.exists(h) is False


@pytest.mark.asyncio
async def test_purge_respects_mtime(tmp_path):
    """古い mtime のファイルだけが過去 cutoff でも削除されることを確認。"""
    arc = _archive(tmp_path)
    h = compute_audio_hash(_SAMPLE)
    await arc.store(h, _SAMPLE)
    enc_path = tmp_path / h[:2] / f"{h}.enc"
    old_ts = (datetime.now(timezone.utc) - timedelta(days=10)).timestamp()
    os.utime(enc_path, (old_ts, old_ts))

    cutoff = datetime.now(timezone.utc) - timedelta(days=5)
    assert await arc.purge_older_than(cutoff) == 1


@pytest.mark.asyncio
async def test_purge_missing_dir_returns_zero(tmp_path):
    arc = EncryptedFileAudioArchive(str(tmp_path / "nope"), os.urandom(_KEY_LEN))
    assert await arc.purge_older_than(datetime.now(timezone.utc)) == 0


# 8. available(): 正しい鍵長で True / 不正鍵長で False（クラッシュしない）
def test_available_key_length(tmp_path):
    assert _archive(tmp_path).available() is True
    short = EncryptedFileAudioArchive(str(tmp_path), b"tooshort")
    assert short.available() is False


@pytest.mark.asyncio
async def test_store_disabled_when_key_invalid(tmp_path):
    """鍵長不正なら store は例外を出さず False を返す。"""
    arc = EncryptedFileAudioArchive(str(tmp_path), b"short")
    assert await arc.store(compute_audio_hash(_SAMPLE), _SAMPLE) is False


# 9. build_audio_archive(): 無効フラグで None / 有効 + 正鍵で実体
def test_build_returns_none_when_disabled(monkeypatch):
    monkeypatch.setattr(archive_mod.settings, "enable_audio_archive", False)
    assert build_audio_archive() is None


def test_build_returns_instance_when_enabled(monkeypatch, tmp_path):
    import base64

    key_b64 = base64.b64encode(os.urandom(_KEY_LEN)).decode()
    monkeypatch.setattr(archive_mod.settings, "enable_audio_archive", True)
    monkeypatch.setattr(archive_mod.settings, "audio_archive_key", key_b64)
    monkeypatch.setattr(
        archive_mod.settings, "audio_archive_dir", str(tmp_path)
    )
    arc = build_audio_archive()
    assert isinstance(arc, EncryptedFileAudioArchive)
    assert arc.available() is True


def test_build_returns_none_when_key_wrong_length(monkeypatch):
    import base64

    bad_b64 = base64.b64encode(b"only16bytes_here!").decode()
    monkeypatch.setattr(archive_mod.settings, "enable_audio_archive", True)
    monkeypatch.setattr(archive_mod.settings, "audio_archive_key", bad_b64)
    assert build_audio_archive() is None


def test_build_returns_none_when_key_missing(monkeypatch):
    monkeypatch.setattr(archive_mod.settings, "enable_audio_archive", True)
    monkeypatch.setattr(archive_mod.settings, "audio_archive_key", None)
    assert build_audio_archive() is None


# 10. 破損ファイルの load は raise せず None
@pytest.mark.asyncio
async def test_load_corrupted_returns_none(tmp_path):
    arc = _archive(tmp_path)
    h = compute_audio_hash(_SAMPLE)
    await arc.store(h, _SAMPLE)
    enc_path = tmp_path / h[:2] / f"{h}.enc"
    enc_path.write_bytes(b"garbage-not-valid-ciphertext")
    assert await arc.load(h) is None
