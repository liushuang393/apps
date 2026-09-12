"""[smoke] 実 LiveKit で 2 クライアント接続・音声→字幕・翻訳音声受信を確認する。

背景:
    リポジトリの ``tests/integration/test_livekit_two_clients.py`` は
    ``pytest.mark.asyncio`` を用いるが pytest-asyncio が未導入のため実行されない。
    受入スモークではこのシナリオ（話者 publish → 聞き手が英語字幕と翻訳音声を受信）
    こそが blocker 4「翻訳音声が字幕へ縮退」の症状判定に直結するため、
    テスト依存を増やさずに同じコルーチンを直接駆動する。

実行（backend / livekit / postgres / redis 稼働下、backend の venv から）:
    cd backend && .venv/bin/python ../output/.../repro/smoke_two_clients.py

判定:
    exit 0 = 緑（英語字幕を受信し、翻訳音声トラックのバイト数 > 0）
    exit 1 = 赤（字幕未達 or 翻訳音声 0 バイト＝ユーザー症状）

注意:
    実 OpenAI API と実 LiveKit を使用する。秘密値は出力しない。
"""

from __future__ import annotations

import asyncio
import os
import pathlib
import sys

_BACKEND = pathlib.Path(__file__).resolve().parents[4] / "backend"
sys.path.insert(0, str(_BACKEND))
os.environ.setdefault("LAMS_API_BASE", "http://localhost:8090")
os.environ.setdefault("LAMS_LIVEKIT_URL", "ws://localhost:7880")


async def main() -> int:
    """2 クライアント E2E シナリオを実行し、緑赤を判定する。"""
    from tests.integration.test_livekit_two_clients import (
        test_livekit_two_clients_subtitle_and_audio as scenario,
    )

    try:
        await scenario()
    except AssertionError as e:
        print(f"[SMOKE-2C] RED: {e}")
        return 1
    except Exception as e:  # noqa: BLE001 - 環境要因も赤として扱い原因を出す。
        print(f"[SMOKE-2C] RED（実行失敗）: {type(e).__name__}: {e}")
        return 1
    print("[SMOKE-2C] GREEN: 2 クライアントで英語字幕と翻訳音声を受信した")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
