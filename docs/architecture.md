# Calqen Architecture

## Overview

Calqen is a monorepo of four packages coordinated through a Postgres database. No direct inter-service communication — all coordination is through DB state.

## Data Flow

```
Telegram User
    │
    ▼ (auth: user ID + chat ID both required)
packages/bot
    │  free-text → POST /api/tasks
    │  command  → POST /api/tasks/:id/approve, etc.
    │
    ▼
packages/api (Hono, Railway)
    │  creates task row, inserts outbox row
    │  exposes all runner + bot routes
    │
    ├──────────────────────────────────┐
    ▼                                  ▼
packages/orchestrator              packages/runner (Windows)
    │  polls draft tasks (5s)          │  polls queued tasks (10s)
    │  classifies, plans               │  dry-run simulation (Phase 1)
    │  all via Claude API              │  diff-policy parser
    │                                  │  heartbeat every 20s
    └──────────────────────────────────┘
                   │
                   ▼
            packages/shared
              Drizzle schema + DB client
              Zod schemas
              Utilities (redact, hash, cost)
```

## Outbox Pattern

The bot never generates or sends Telegram messages directly. Every outbound message is:
1. Inserted into `telegram_outbox` by the API or orchestrator
2. Polled by the bot every 3s
3. Atomically claimed (pending → sending) with a delivery lease
4. Sent to Telegram
5. Marked sent via POST /api/bot/messages/:id/sent

This provides at-least-once delivery. `dedupe_key` prevents logical duplicates.

## Atomic Claiming

All worker claims use `FOR UPDATE SKIP LOCKED` inside transactions so concurrent workers never race.

- Orchestrator: `draft → classifying`, `classified → planning`
- Runner: `queued → in_progress`
- Bot outbox delivery: `pending → sending` with delivery lease

## Lease Lifecycle

Runner leases expire after 60s without a heartbeat. Background job (30s interval):
- Finds `in_progress` tasks with `lease_expires_at < now()`
- Clears lease fields, sets task → `queued`
- Sets runner → `offline`
- Queues `runner_disconnected` outbox message

## Spend Controls

Before every real (non-mock) agent call:
1. Check `spent_usd >= budget_usd` → BudgetExceededError
2. Check `Date.now() > deadline` → TimeoutError

After call: increment `tasks.spent_usd` atomically.

## Secret Redaction

Applied before every write to `agent_runs`, `artifacts`, `audit_events`. Explicit allowlist of env key names + regex patterns for tokens/JWTs/URIs.

## Phase 1 vs Phase 2

Phase 1: ArchitectAgent, BuilderAgent, VerifierAgent are all mocked. Runner is dry-run only (no disk writes, no Git). Diff-policy parser runs against mock diff.

Phase 2: Real agents with Claude Agent SDK, real Git worktrees, real test execution.
