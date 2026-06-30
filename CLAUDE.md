# Calqen — Claude Code Instructions

## Project Overview
Calqen is a production-grade AI orchestration system for delegating software development work across multiple repositories. It is not a demo.

## Repository Structure
```
packages/
  shared/       — DB schema, Zod schemas, types, utilities
  api/          — Hono REST API (Railway)
  bot/          — grammY Telegram bot (thin messenger)
  orchestrator/ — Worker loop, agent logic, Claude API calls
  runner/       — Local Windows runner (dry-run Phase 1)
docs/           — Architecture and contract documentation
```

## Non-Negotiable Rules
1. TypeScript strict mode. No `any`. No `as unknown as X`.
2. All agent I/O validated with Zod before use.
3. Normal CRUD uses Drizzle query builder. Concurrency-critical operations use parameterised `sql` fragments inside transactions. Never unparameterised string concatenation.
4. Secrets from env only. Never hardcoded. Never in DB.
5. Bot sends nothing directly — all outbound messages go through `telegram_outbox`.
6. Bot routes require `CALQEN_BOT_SERVICE_TOKEN`. Runner routes require per-runner token.
7. `POST /api/runner/register` uses registration-secret middleware only. Rate-limited.
8. Telegram auth checks both `user.id` AND `chat.id`.
9. Orchestrator claims tasks atomically. Two workers cannot race.
10. Runner claims tasks atomically with `FOR UPDATE SKIP LOCKED`.
11. Runner never operates on a protected branch.
12. Phase 1 runner is simulation only — no disk writes, no Git.
13. No unapproved deletion committed, pushed, or marked complete.
14. Approval `scope_hash` verified at execution time.
15. When deletions found, runner releases lease and exits cleanly.
16. `cancel_requested_at` checked before every stage.
17. Budget checked before each real agent run.
18. Mock runs: `is_mock: true`, `provider: 'mock'`, null cost/tokens.
19. `redactSecrets()` applied before every DB write of text/JSON content.
20. `prepare: false` on runtime DB client (Supabase transaction pooling).
21. `MIGRATIONS_DATABASE_URL` for migrations only; `DATABASE_URL` for runtime.
22. Calqen never invents commands — reads from `project.settings`.

## Commands
- `pnpm typecheck` — type-check all packages
- `pnpm lint` — lint all packages
- `pnpm test` — run all tests
- `pnpm db:migrate` — apply migrations via MIGRATIONS_DATABASE_URL
- `pnpm db:seed` — insert seed data
- `pnpm dev:api` — start API on port 3001
- `pnpm dev:bot` — start Telegram bot
- `pnpm dev:orchestrator` — start orchestrator worker
- `pnpm dev:runner` — start local runner

## Environment
All secrets via Doppler/env vars. See `.env.example`. Never hardcode.

## Phase Status
- Gate 1: Foundation ✅ (schema, utilities, migrations, seed, tests)
- Gate 2: API and State (pending)
- Gate 3: Intelligence (pending)
- Gate 4: Runner and Integration (pending)
