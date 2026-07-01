# Calqen Deployment

## Runtime Requirement

Node 24 (`.nvmrc`) is required for local development and VPS Docker builds — pinned `pnpm@11.9.0` (see root `package.json`) requires Node >=22.13, and Node 20 reached end-of-life.

## Local Development

Unchanged by this document. Local dev still runs each service directly via Doppler, never Docker:

```bash
doppler run -- pnpm dev:api
doppler run -- pnpm dev:bot
doppler run -- pnpm dev:orchestrator
doppler run -- pnpm dev:runner
```

Each service validates its own required environment variables on startup (`packages/shared/src/env.ts`) and exits with code 1, logging only the missing variable *names*, if anything is absent.

## Deployment Split

| Component | Runs on | Why |
|---|---|---|
| `packages/api` | VPS (Docker) | Stateless HTTP service, no local filesystem dependency |
| `packages/bot` | VPS (Docker) | Stateless Telegram poller/outbox worker |
| `packages/orchestrator` | VPS (Docker) | Stateless claim/classify/plan/research loop |
| `packages/runner` | Windows PC | Phase 1 dry-run boundary — never containerized, never moved off the local machine |
| PostgreSQL | Supabase (external) | Already managed, outside this compose stack entirely |

## Environment Variables

Names only — see `.env.example` for the authoritative list, never commit real values. The server-side `.env` (or Doppler-injected environment) needs the same variables local dev uses:

```
ANTHROPIC_API_KEY
CALQEN_ORCHESTRATOR_MODEL, CALQEN_ARCHITECT_MODEL, CALQEN_FAST_MODEL
TELEGRAM_BOT_TOKEN
AUTHORIZED_TELEGRAM_USER_IDS, AUTHORIZED_TELEGRAM_CHAT_IDS
CALQEN_BOT_SERVICE_TOKEN
DATABASE_URL, MIGRATIONS_DATABASE_URL, SUPABASE_URL
GITHUB_TOKEN
FIRECRAWL_API_KEY
RUNNER_REGISTRATION_SECRET
CALQEN_DEFAULT_TASK_BUDGET_USD, CALQEN_MAX_TASK_DURATION_MS, CALQEN_MAX_RESEARCH_SOURCES, CALQEN_MAX_AGENT_RETRIES
NODE_ENV, CALQEN_API_URL, PORT
```

`GIT_SHA` is a build-time argument only (`docker build --build-arg GIT_SHA=$(git rev-parse HEAD)`), not a runtime secret — it does not belong in `.env`.

The Runner (Windows PC) only needs `RUNNER_REGISTRATION_SECRET`, `CALQEN_API_URL`, and its own `RUNNER_*` tuning variables — it is not part of the VPS deployment.

## Build, Start, Update, Rollback

```bash
# Build (from repo root, on the VPS)
GIT_SHA=$(git rev-parse HEAD) docker compose build

# Start
docker compose up -d

# Update to latest master
git pull
GIT_SHA=$(git rev-parse HEAD) docker compose up -d --build

# Roll back to a known-good tag
git checkout v0.1.0-phase1
docker compose down
GIT_SHA=$(git rev-parse HEAD) docker compose up -d --build
```

## Health Checks

`GET /api/health` is the one endpoint any reverse proxy or Docker `HEALTHCHECK` should hit:

```json
{ "service": "api", "status": "ok", "version": "<git-sha-or-dev>", "timestamp": "<iso8601>" }
```

It is public/unauthenticated (see `docs/security.md`'s API Authentication table), does not touch the database, and cannot leak connection errors. `docker-compose.yml`'s `api` service already wires this in as its `healthcheck`. `bot` and `orchestrator` have no HTTP endpoint to probe — their health is observed via `docker compose logs` and the shutdown/startup log lines each emits.

## Troubleshooting

| Symptom | Check |
|---|---|
| Container exits immediately after start | `docker compose logs <service>` — look for the `[env] <service> is missing required environment variables: ...` fail-fast line |
| `api` healthcheck failing | `curl -f http://localhost:3001/api/health` directly on the host |
| Container won't rebuild after a code change | Confirm `GIT_SHA` build arg was passed and the image wasn't served from a stale layer cache |
| Service doesn't stop cleanly on `docker compose down` | Confirm the container logs the one-line `[<service>] shutting down` message — if absent, the process was killed before its `SIGTERM` handler ran (default compose stop timeout is 10s) |
