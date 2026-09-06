# ビルドコンテキストはリポジトリルート（docker-compose の context: .）
FROM python:3.10-slim AS base

WORKDIR /app

# システム依存パッケージのインストール
# gcc/g++/python3-dev: ネイティブ拡張のコンパイルに必要
# libpq-dev: PostgreSQL接続に必要
# ffmpeg: ローカル音声処理の補助
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    g++ \
    python3-dev \
    libpq-dev \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY backend/pyproject.toml .
COPY backend/app/ ./app/
COPY backend/alembic.ini .
COPY backend/alembic/ ./alembic/
COPY scripts/prepare_local_models.py ./scripts/prepare_local_models.py

# INSTALL_LOCAL=1 のときだけ .[local] を導入（GPU イメージ向け）。
ARG INSTALL_LOCAL=0
RUN if [ "$INSTALL_LOCAL" = "1" ]; then \
      pip install --no-cache-dir ".[local]"; \
    else \
      pip install --no-cache-dir .; \
    fi

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
