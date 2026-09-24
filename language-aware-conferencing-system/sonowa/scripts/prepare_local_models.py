#!/usr/bin/env python3
"""方式3（ローカル）の Gemma 4 E2B を固定 revision で取得する。

目的:
    Docker / ホスト上で 4言語ローカルパイプライン用モデルを永続キャッシュへ準備する。
    - ASR/MT: google/gemma-4-E2B-it（Apache-2.0）
    - TTS: Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice（Apache-2.0、ja/en/zh）

使い方:
    python scripts/prepare_local_models.py --output-dir /models
    # Docker:
    docker compose exec backend python /app/scripts/prepare_local_models.py \\
        --output-dir /models

環境変数:
    SONOWA_MODEL_DIR  既定 /models（--output-dir 未指定時）
    HF_HOME           既定 <output-dir>/hf

注意:
    モデルはアプリイメージへ埋め込まない。実行時は取得済みキャッシュのみを読む。
"""

from __future__ import annotations

import argparse
import logging
import os
from pathlib import Path

DEFAULT_DIR = os.environ.get("SONOWA_MODEL_DIR", "/models")
# 実行時ステージ（local_multimodal / local_tts）と同じ固定 revision。
MODELS = (
    ("google/gemma-4-E2B-it", "3e22461f65e89153144f8adb70e3b8c2cc9845a7"),
    (
        "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
        "85e237c12c027371202489a0ec509ded67b5e4b5",
    ),
)
logger = logging.getLogger(__name__)


def main() -> int:
    """ローカルモデルを取得し、失敗は非ゼロで返す。"""
    logging.basicConfig(level=logging.INFO)
    parser = argparse.ArgumentParser(description="Prepare Sonowa local GPU models")
    parser.add_argument("--output-dir", default=DEFAULT_DIR)
    args = parser.parse_args()
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    hub = str(Path(os.environ.get("HF_HOME", str(output_dir / "hf"))) / "hub")
    try:
        from huggingface_hub import snapshot_download

        for model, revision in MODELS:
            snapshot_download(model, revision=revision, cache_dir=hub)
            logger.info("モデル取得完了: %s@%s", model, revision[:8])
    except (ImportError, OSError, RuntimeError, ValueError) as exc:
        logger.error("モデル準備失敗: %s", exc)
        return 1
    logger.info("準備完了。管理画面で「方式3 ローカル」を選択してください")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
