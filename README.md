# Calqen

AI orchestration control plane for delegating software development across multiple repositories.

## What it does

Send a Telegram message. Calqen classifies, plans, gets approval, and delegates execution to a local runner — all with atomic state transitions, lease management, and audit trails.

## Architecture

- **Bot** — thin grammY messenger; delivers outbox messages only
- **API** — Hono REST (Railway); manages state, auth, outbox
- **Orchestrator** — worker loop; classifies tasks, runs agents
- **Runner** — local Windows process; executes code tasks dry-run (Phase 1)

## Setup

```bash
cp .env.example .env
# Fill in secrets via Doppler or manually
pnpm install
pnpm db:migrate
pnpm db:seed
```

## Development

```bash
pnpm dev:api         # port 3001
pnpm dev:bot
pnpm dev:orchestrator
pnpm dev:runner
```

## Testing

```bash
pnpm typecheck
pnpm lint
pnpm test
```

## Owner

Kaine Macgregor — [kmac97](https://github.com/kmac97)
