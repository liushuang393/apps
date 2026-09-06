#!/usr/bin/env python3
"""ローカル GPU モデルの取得と MADLAD CT2 変換。

目的:
    Docker / ホスト上で 4言語ローカルパイプライン用モデルを準備する。
    - ASR: Systran/faster-whisper-medium（faster-whisper が初回ロード時に取得）
    - MT: google/madlad400-3b-mt を CTranslate2 int8 へ変換
    - TTS: openbmb/VoxCPM2（voxcpm が初回ロード時に取得）

使い方:
    python scripts/prepare_local_models.py --output-dir /models
    # Docker:
    docker compose exec backend python /app/scripts/prepare_local_models.py \\
        --output-dir /models

環境変数:
    LAMS_MODEL_DIR  既定 /models（--output-dir 未指定時）

注意:
    モデルはアプリイメージへ埋め込まない。永続ボリュームへ書き出す。
    変換には ctranslate2 / transformers が必要（pip install '.[local]'）。
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

DEFAULT_DIR = os.environ.get("LAMS_MODEL_DIR", "/models")
MADLAD_SRC = "google/madlad400-3b-mt"
MADLAD_OUT_NAME = "madlad400-3b-mt-int8"
ASR_HINT = "Systran/faster-whisper-medium"
TTS_HINT = "openbmb/VoxCPM2"


def _run(cmd: list[str]) -> None:
    print("+", " ".join(cmd), flush=True)
    subprocess.run(cmd, check=True)


def prepare_madlad(output_dir: Path) -> Path:
    """MADLAD を CT2 int8 へ変換し、出力ディレクトリを返す。"""
    out = output_dir / MADLAD_OUT_NAME
    if (out / "model.bin").exists():
        print(f"[ok] MADLAD CT2 既存: {out}", flush=True)
        return out
    out.parent.mkdir(parents=True, exist_ok=True)
    _run(
        [
            "ct2-transformers-converter",
            "--model",
            MADLAD_SRC,
            "--output_dir",
            str(out),
            "--quantization",
            "int8",
            "--force",
        ]
    )
    print(f"[ok] MADLAD CT2 変換完了: {out}", flush=True)
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description="Prepare LAMS local GPU models")
    parser.add_argument("--output-dir", default=DEFAULT_DIR)
    parser.add_argument(
        "--skip-madlad",
        action="store_true",
        help="MADLAD 変換をスキップ（ASR/TTS はランタイム取得）",
    )
    args = parser.parse_args()
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"出力先: {output_dir}", flush=True)
    print(f"ASR（初回推論時取得）: {ASR_HINT}", flush=True)
    print(f"TTS（初回推論時取得）: {TTS_HINT}", flush=True)

    madlad_path: Path | None = None
    if not args.skip_madlad:
        try:
            madlad_path = prepare_madlad(output_dir)
        except FileNotFoundError:
            print(
                "ct2-transformers-converter が見つかりません。"
                " pip install '.[local]' 後に再実行してください。",
                file=sys.stderr,
            )
            return 1
        except subprocess.CalledProcessError as exc:
            print(f"MADLAD 変換失敗: {exc}", file=sys.stderr)
            return 1

    env_hint = (
        f"LOCAL_MT_MODEL_DIR={madlad_path}"
        if madlad_path
        else "LOCAL_MT_MODEL_DIR=<madlad-ct2-dir>"
    )
    print("\n推奨 env:", flush=True)
    print(f"  {env_hint}", flush=True)
    print("  LOCAL_ASR_MODEL=Systran/faster-whisper-medium", flush=True)
    print("  LOCAL_TTS_MODEL=openbmb/VoxCPM2", flush=True)
    print("  VRAM_BUDGET_MB=7500", flush=True)
    print("  ASR_PROVIDER=local MT_PROVIDER=local TTS_PROVIDER=local", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
