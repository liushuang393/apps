FROM python:3.10-slim AS base

WORKDIR /app

# システム依存パッケージのインストール
# gcc, python3-dev: webrtcvadのコンパイルに必要
# libpq-dev: PostgreSQL接続に必要
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    python3-dev \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml .
COPY app/ ./app/
COPY alembic.ini .
COPY alembic/ ./alembic/
RUN pip install --no-cache-dir .

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
