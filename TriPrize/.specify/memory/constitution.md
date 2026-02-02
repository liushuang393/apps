<!--
SYNC IMPACT REPORT
==================
Version Change: Initial → 1.0.0
Modified Principles: N/A (new constitution)
Added Sections:
  - Core Principles (4 principles: Code Quality First, Test-Driven Development, User Experience Consistency, Performance & Scalability)
  - Development Standards (Code Organization, Security Requirements, Documentation Standards)
  - Quality Gates (Pre-Commit, Pre-Merge, Pre-Deployment)
  - Governance (Amendment Process, Compliance, Exception Handling, Continuous Improvement)
Removed Sections: N/A (new constitution)
Templates Status:
  ✅ plan-template.md - UPDATED with detailed Constitution Check checklist
  ✅ spec-template.md - aligned with user story requirements and UX principles
  ✅ tasks-template.md - aligned with TDD requirements and quality principles
  ℹ️  commands/*.md - no command files found to update
Follow-up TODOs: None
-->

# TriPrize Apps Constitution

## Core Principles

### I. Code Quality First

**MUST Requirements:**
- All TypeScript code MUST use strict type checking with no implicit `any` types
- Code MUST follow ESLint/TSLint rules without exceptions or warnings
- All functions MUST have explicit return types declared
- All public APIs MUST include comprehensive JSDoc documentation
- Deprecated APIs MUST NOT be used; existing usage MUST be refactored
- Code reviews MUST verify zero linting errors before merge

**Rationale:** Our applications handle real-time AI processing and user subscriptions where reliability is non-negotiable. Type safety prevents runtime errors that could interrupt live translation sessions or payment processing. Consistent code quality ensures maintainability across multiple projects in the monorepo.

### II. Test-Driven Development (NON-NEGOTIABLE)

**MUST Requirements:**
- Tests MUST be written BEFORE implementation (Red-Green-Refactor cycle)
- User acceptance tests MUST be reviewed and approved before writing code
- Contract tests MUST cover all API endpoints and external integrations (OpenAI, Gemini, Stripe, Supabase)
- Integration tests MUST verify cross-component interactions (audio pipeline, authentication flow, payment processing)
- Unit tests MUST achieve 80% code coverage minimum
- All tests MUST pass before merge; failing tests block deployment

**Rationale:** Real-time translation applications cannot fail during live sessions. Payment processing must be bulletproof. TDD ensures features work correctly before reaching users. API contract changes (OpenAI, Stripe webhooks) can break production; contract tests catch these early.

### III. User Experience Consistency

**MUST Requirements:**
- All user-facing applications MUST provide <2-minute setup for new users
- Error messages MUST be human-readable with actionable next steps (no technical jargon)
- UI MUST support internationalization (i18n) with fallback to English
- All interactive elements MUST provide visual feedback within 100ms
- Loading states MUST be shown for operations exceeding 200ms
- Settings MUST persist across sessions with automatic recovery
- MUST support both light/dark themes where applicable

**Rationale:** Users span 35+ languages and varying technical expertise. Subscription-based services (550円/month) require professional UX. Real-time translation must feel instantaneous (<200ms is perceptible). Frustrating UX leads to churn in subscription models.

### IV. Performance & Scalability

**MUST Requirements:**
- Audio processing latency MUST stay below 200ms (p95)
- API responses MUST complete within 500ms (p95) excluding AI provider time
- Memory usage MUST stay below 150MB for Electron apps, 50MB for extensions
- Bundle sizes: Chrome extensions ≤ 2MB, Electron apps ≤ 100MB
- Database queries MUST use proper indexes; no full table scans
- WebSocket connections MUST implement automatic reconnection with exponential backoff
- MUST implement rate limiting and quota management for API usage

**Rationale:** Real-time translation requires <200ms latency for natural conversation flow. Chrome extensions have strict size limits. Serverless functions (Vercel/Cloudflare Workers) bill per memory usage. Poor performance degrades user experience and increases infrastructure costs.

## Development Standards

### Code Organization
- **Monorepo Structure**: Each project maintains independence with shared configurations
- **Naming Conventions**: camelCase for variables/functions, PascalCase for components/classes, UPPER_SNAKE_CASE for constants
- **File Structure**: Group by feature (`components/`, `services/`, `utils/`) not by file type
- **Configuration**: Centralize shared configs (TypeScript, ESLint, Prettier) at monorepo root

### Security Requirements
- API keys MUST be stored encrypted in secure storage (Chrome Storage API, Electron SafeStorage)
- User authentication MUST use OAuth 2.0 (Google, Better Auth) with secure token handling
- Payment processing MUST use Stripe webhooks with signature verification
- All external API calls MUST validate responses and sanitize inputs
- Sensitive data (API keys, tokens) MUST NEVER be logged

### Documentation Standards
- Every feature MUST have a corresponding spec in `.specify/specs/[###-feature-name]/`
- Public APIs MUST include usage examples and error handling documentation
- Breaking changes MUST be documented in CHANGELOG.md with migration guides
- README.md MUST be updated for new features affecting user setup

## Quality Gates

### Pre-Commit
- Linting MUST pass (ESLint/TSLint with zero errors)
- TypeScript compilation MUST succeed with strict mode
- Pre-commit hooks MUST enforce formatting (Prettier)

### Pre-Merge
- All tests MUST pass (unit, integration, contract)
- Code coverage MUST meet 80% threshold
- Peer review MUST approve changes
- No TODO or FIXME comments in production code without linked issues

### Pre-Deployment
- End-to-end tests MUST pass for critical user journeys
- Performance benchmarks MUST be within acceptable thresholds
- Security scanning MUST show no high/critical vulnerabilities
- Deployment MUST use canary releases for Electron apps (5% rollout → monitor → 100%)

## Governance

This constitution supersedes all other development practices and guidelines.

**Amendment Process:**
- Amendments require documented justification and team consensus
- Amendments triggering MAJOR version changes require migration plans for existing code
- Version increments follow semantic versioning (MAJOR.MINOR.PATCH)

**Compliance:**
- All pull requests MUST verify compliance with this constitution
- Non-compliant code MUST be rejected during code review
- Complexity additions MUST be justified in `plan.md` Complexity Tracking section
- Constitution violations require explicit justification and approval

**Exception Handling:**
- Emergency fixes MAY bypass testing requirements with post-fix test coverage
- Prototypes and experiments MUST be clearly marked and isolated in separate branches
- Technical debt MUST be tracked with GitHub issues and prioritized in sprint planning

**Continuous Improvement:**
- Constitution MUST be reviewed quarterly for relevance
- Feedback from production incidents MUST inform principle updates
- Performance metrics guide threshold adjustments

**Version**: 1.0.0 | **Ratified**: 2025-11-11 | **Last Amended**: 2025-11-11
