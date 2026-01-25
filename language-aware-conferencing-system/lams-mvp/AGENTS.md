# AGENTS.md

This file is for agentic coding assistants working in this repository.
Follow the commands and rules here before making changes.

## Sources
- `CLAUDE.md`
- `DEVELOPMENT_RULES.md`
- `backend/pyproject.toml` (Ruff)
- `frontend/.eslintrc.cjs` and `frontend/tsconfig.json`
- `scripts/check.sh`

## Quick Orientation
- Monorepo with `backend/` (FastAPI) and `frontend/` (React + Vite)
- Shared quality gate: `./scripts/check.sh`
- Languages: Python 3.10+, TypeScript (strict)

## Build / Lint / Type Check

### All Checks
```bash
./scripts/check.sh
```

### Auto-fix Formatting and Lint
```bash
./scripts/check.sh --fix
```

### Backend Only
```bash
./scripts/check.sh --backend
```

### Frontend Only
```bash
./scripts/check.sh --frontend
```

### Backend Lint + Format (Ruff)
```bash
cd backend
ruff check app/
ruff format app/
```

### Frontend Lint + Type Check
```bash
cd frontend
npm run lint
npm run type-check
```

### Build
```bash
cd frontend
npm run build
```

### Dev Servers
```bash
# Backend
cd backend
uvicorn app.main:app --reload --port 8000

# Frontend
cd frontend
npm run dev
```

## Tests (Single Test Emphasis)

### Backend Tests
```bash
cd backend
pytest
```

### Run One Test File
```bash
cd backend
pytest tests/test_ai_providers.py
```

### Run One Test Case
```bash
cd backend
pytest tests/test_ai_providers.py -k "test_name_substring"
```

### Notes
- No frontend unit test script is configured in `frontend/package.json`.
- Playwright is listed at repo root, but no config was found.

## Code Style Guidelines

### General
- Encoding: UTF-8 (no BOM) for source/config files.
- Comments: use formal Japanese; functions/classes must describe purpose,
  inputs, outputs, and notes. Mark unknowns as "不明" rather than guessing.
- No debug leftovers: `console.log` / `print` are forbidden.
- No magic numbers: extract to constants.
- No secrets in code: use env vars and `.env`.
- Avoid leaving commented-out code or TODOs without issues.

### TypeScript / React
- `strict: true`; `any` is forbidden (use `unknown`).
- `@ts-ignore` / `@ts-expect-error` are forbidden.
- Use function components and custom hooks to separate logic.
- Props must be defined with `interface`.
- Lint rules:
  - `@typescript-eslint/no-unused-vars` errors unless arg name starts with `_`.
  - `react-refresh/only-export-components` is enforced.
- Imports: keep them organized; no unused imports.
- Naming:
  - Components: `PascalCase`.
  - Functions/variables: `camelCase`.
  - Types/interfaces: `PascalCase`.
  - Constants: `UPPER_SNAKE_CASE`.

### Python / FastAPI
- Type hints required for args and returns.
- Use `logging` module; never `print()`.
- Prefer `async/await` for I/O work.
- Validate inputs with Pydantic models.
- Raise explicit exceptions; avoid bare `except`.
- Imports are ordered by Ruff (isort rules).

### Formatting and Linting
- Ruff line length: 88.
- Ruff rules enabled: E, W, F, I, B, C4, UP, ARG, SIM.
- Ruff format uses double quotes and spaces.
- ESLint is required for frontend; keep warnings at zero.

## Error Handling and Reliability
- Always handle failure paths for network or I/O calls.
- Prefer explicit error types and messages.
- Log key actions at appropriate levels (info/warn/error).

## Repo-Specific Rules
- Do not manually edit `package.json` or `pyproject.toml`; use package tools.
- Do not hardcode API keys or secrets.
- Before committing: `./scripts/check.sh` must pass.

## Cursor / Copilot Rules
- No `.cursor/rules/`, `.cursorrules`, or `.github/copilot-instructions.md`
  were found in this repository.
