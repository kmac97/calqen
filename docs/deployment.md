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

## Networking

`CALQEN_API_URL` is not a single value — it depends on who's calling:

| Caller | `CALQEN_API_URL` | Why |
|---|---|---|
| Local dev (bot/runner running directly on host) | `http://localhost:3001` | Default in `.env.example`, all services on the same machine |
| VPS Docker services calling the API internally (`bot`) | `http://api:3001` | Set via `docker-compose.yml`'s `bot.environment:`, not `.env` — inside the `bot` container, `localhost` means the bot container itself, not the `api` container. Compose's built-in DNS resolves the service name `api` to the right container on the internal network. `orchestrator` never calls the API (it talks to Postgres directly), so it needs no override. |
| Windows Runner (production) | `https://calqen.duckdns.org` | The Runner is outside the compose network entirely — it must go through the public URL, never the internal `http://api:3001` |

The `api` service publishes to `127.0.0.1:3001` on the VPS host — not `0.0.0.0` — so it is not reachable from the public internet directly. Nginx (configured on the VPS, outside this repo) is the sole public entry point: it terminates TLS for `https://calqen.duckdns.org` and reverse-proxies to `127.0.0.1:3001`. `bot` and `orchestrator` reach `api` over the compose-internal network regardless of the host port binding, so loopback-only publishing doesn't affect them.

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
| `api` healthcheck failing | `curl -f http://localhost:3001/api/health` directly on the VPS host — `api` publishes to `127.0.0.1` only, so this must be run on the host itself, not remotely |
| `bot` can't reach the API in Docker but works in local dev | Confirm `docker-compose.yml`'s `bot.environment` still overrides `CALQEN_API_URL` to `http://api:3001` — `bot`'s `.env` value (`http://localhost:3001`) is correct for local dev but resolves to the `bot` container itself inside Docker |
| Container won't rebuild after a code change | Confirm `GIT_SHA` build arg was passed and the image wasn't served from a stale layer cache |
| Service doesn't stop cleanly on `docker compose down` | Confirm the container logs the one-line `[<service>] shutting down` message — if absent, the process was killed before its `SIGTERM` handler ran (default compose stop timeout is 10s) |
