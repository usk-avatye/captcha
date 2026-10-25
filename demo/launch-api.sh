#!/bin/sh
set -eu

if [ -f /app/alembic.ini ] && [ -f /app/migrations/env.py ]; then
    python -m alembic -c /app/alembic.ini upgrade head
fi

if [ -d /app/scripts ] && [ -f /app/scripts/seed.py ]; then
    python -m scripts.seed
    exec uvicorn app.main:app --host 0.0.0.0 --port 8002
fi

exec uvicorn app.main:app --host 0.0.0.0 --port 8001
