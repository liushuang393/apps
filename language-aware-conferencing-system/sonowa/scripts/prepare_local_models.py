#!/usr/bin/env python3
"""2モデルのローカル GPU 構成を取得する。旧3モデルは明示指定時のみ準備する。

目的:
    Docker / ホスト上で 4言語ローカルパイプライン用モデルを準備する。
    - ASR/MT: Gemma 4 E2B IT を固定 revision で永続キャッシュへ取得
    - TTS: openbmb/VoxCPM2 を取得
    - --legacy-three-models: 比較用 Whisper/MADLAD/VoxCPM2 を取得・変換

使い方:
    python scripts/prepare_local_models.py --output-dir /models
    # Docker:
    docker compose exec backend python /app/scripts/prepare_local_models.py \\
        --output-dir /models

環境変数:
    SONOWA_MODEL_DIR  既定 /models（--output-dir 未指定時）

注意:
    モデルはアプリイメージへ埋め込まない。永続ボリュームへ書き出す。
    変換には ctranslate2 / transformers が必要（pip install '.[local]'）。
"""

from __future__ import annotations

import argparse
import logging
import os
from pathlib import Path

DEFAULT_DIR = os.environ.get("SONOWA_MODEL_DIR", "/models")
MADLAD_SRC = "google/madlad400-3b-mt"
MADLAD_OUT_NAME = "madlad400-3b-mt-int8"
ASR_HINT = "Systran/faster-whisper-medium"
TTS_HINT = "openbmb/VoxCPM2"
OMNIVOICE_MODEL = "k2-fsa/OmniVoice"
OMNIVOICE_REVISION = "c5fdb5ccb189668d56333f77ba2629f4cd7535f4"
GEMMA_MODEL = "google/gemma-4-E2B-it"
GEMMA_REVISION = "3e22461f65e89153144f8adb70e3b8c2cc9845a7"
logger = logging.getLogger(__name__)
MADLAD_REQUIRED_FILES = ("model.bin", "config.json", "shared_vocabulary.json")


def prepare_madlad(output_dir: Path) -> Path:
    """MADLAD を CT2 int8 へ変換し、出力ディレクトリを返す。"""
    out = output_dir / MADLAD_OUT_NAME
    if out.exists() and any(out.iterdir()):
        if not all(
            (out / name).is_file() and (out / name).stat().st_size
            for name in MADLAD_REQUIRED_FILES
        ):
            raise RuntimeError(f"MADLAD 変換成果物が不完全です: {out}")
        logger.info("MADLAD CT2 既存: %s", out)
        return out
    out.parent.mkdir(parents=True, exist_ok=True)
    from ctranslate2.converters import TransformersConverter

    converter = TransformersConverter(
        MADLAD_SRC, load_as_float16=True, low_cpu_mem_usage=True
    )
    converter.convert(str(out), quantization="int8", force=True)
    logger.info("MADLAD CT2 変換完了: %s", out)
    return out


def prepare_speech(cache_dir: Path) -> None:
    """ASR/TTS と MT tokenizer を指定キャッシュへ事前取得する。"""
    from huggingface_hub import snapshot_download
    from transformers import AutoTokenizer

    hub = str(cache_dir / "hub")
    for model in (ASR_HINT, TTS_HINT):
        snapshot_download(model, cache_dir=hub)
        logger.info("モデル取得完了: %s", model)
    AutoTokenizer.from_pretrained("jbochi/madlad400-3b-mt", cache_dir=hub)
    logger.info("MT tokenizer 取得完了")


def main() -> int:
    """指定先へ省メモリ変換を実行し、失敗は非ゼロで返す。"""
    logging.basicConfig(level=logging.INFO)
    parser = argparse.ArgumentParser(description="Prepare Sonowa local GPU models")
    parser.add_argument("--output-dir", default=DEFAULT_DIR)
    parser.add_argument("--legacy-three-models", action="store_true")
    parser.add_argument(
        "--tts-model",
        choices=(TTS_HINT, OMNIVOICE_MODEL),
        default=os.environ.get("LOCAL_TTS_MODEL", TTS_HINT),
        help="2モデル構成で使用する音声モデル（OmniVoiceは非商用）",
    )
    parser.add_argument(
        "--skip-madlad",
        action="store_true",
        help="MADLAD 変換をスキップし、ASR/TTS/tokenizer のみ取得",
    )
    args = parser.parse_args()
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    logger.info("出力先: %s", output_dir)
    cache_dir = Path(os.environ.get("HF_HOME", str(output_dir / "hf")))
    if not args.legacy_three_models:
        if args.skip_madlad:
            parser.error("--skip-madlad は --legacy-three-models と併用してください")
        try:
            from huggingface_hub import snapshot_download

            hub = str(cache_dir / "hub")
            snapshot_download(GEMMA_MODEL, revision=GEMMA_REVISION, cache_dir=hub)
            if args.tts_model == OMNIVOICE_MODEL:
                snapshot_download(
                    OMNIVOICE_MODEL, revision=OMNIVOICE_REVISION, cache_dir=hub
                )
            else:
                snapshot_download(TTS_HINT, cache_dir=hub)
            logger.info("2モデル準備完了: %s + %s", GEMMA_MODEL, args.tts_model)
            return 0
        except (ImportError, OSError, RuntimeError, ValueError) as exc:
            logger.error("2モデル準備失敗: %s", exc)
            return 1
    logger.info("ASR: %s", ASR_HINT)
    logger.info("TTS: %s", TTS_HINT)

    madlad_path: Path | None = None
    if not args.skip_madlad:
        try:
            madlad_path = prepare_madlad(output_dir)
        except (ImportError, OSError, RuntimeError, ValueError) as exc:
            logger.error("MADLAD 変換失敗: %s", exc)
            return 1

    try:
        prepare_speech(cache_dir)
    except (ImportError, OSError, RuntimeError, ValueError) as exc:
        logger.error("音声モデル準備失敗: %s", exc)
        return 1

    env_hint = (
        f"LOCAL_MT_MODEL_DIR={madlad_path}"
        if madlad_path
        else "LOCAL_MT_MODEL_DIR=<madlad-ct2-dir>"
    )
    logger.info("推奨設定: %s", env_hint)
    logger.info("LOCAL_ASR_MODEL=%s LOCAL_TTS_MODEL=%s", ASR_HINT, TTS_HINT)
    logger.info("VRAM_BUDGET_MB=7500; 管理画面で ASR/MT/TTS=local を選択")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
