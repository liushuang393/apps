<!-- sr-local -->
# lint

    ruff check backend/app/ && npm --prefix frontend run lint

Pass: exit 0.
Invalidation: backend/pyproject.toml frontend/package.json frontend/.eslintrc.cjs
Baseline: see .agents/state/readiness/baselines/lint.json
