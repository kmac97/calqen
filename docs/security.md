# Calqen Security Model

## Telegram Authorization

Both checks required — failing either drops the message silently (no reply, no log, no task):

```typescript
const authorisedUsers = process.env.AUTHORIZED_TELEGRAM_USER_IDS!
  .split(',').map(id => parseInt(id.trim(), 10))
const authorisedChats = process.env.AUTHORIZED_TELEGRAM_CHAT_IDS!
  .split(',').map(id => parseInt(id.trim(), 10))

if (!authorisedUsers.includes(userId) || !authorisedChats.includes(chatId)) {
  return // silent drop
}
```

Chat ID alone is insufficient — another user in a group could otherwise send commands.

## API Authentication

| Route | Auth |
|---|---|
| `GET /api/health` | Public |
| `POST /api/runner/register` | Registration-secret only + rate limit (5/IP/hour) |
| All other `POST /api/runner/*` | Per-runner bcrypt token |
| All bot routes | `CALQEN_BOT_SERVICE_TOKEN` bearer token |

Bot and runner middleware are separate and never share tokens.

## Runner Registration

1. POST /api/runner/register with `registrationSecret`
2. Server generates 32-byte hex token
3. Stores `bcrypt.hash(token, 12)` — plaintext never persisted
4. Returns `{ runnerId, runnerToken }` — shown exactly once
5. Runner saves to `.runner-token` (gitignored)

## Lease Verification

Every runner API call includes `leaseId`. API verifies `tasks.lease_id === request.leaseId`. Mismatch → 409. Stale runners are rejected immediately.

## Scope Hash Binding

Every plan approval is bound to `scope_hash = sha256(canonicalJson(plan))`. Before execution, runner re-verifies. Mismatch → new approval required, no proceed.

## Deletion Policy

Deletions are not pre-emptively blocked at the command level (too many bypass routes). Detection is at the output boundary:
1. After Builder produces diff, parser checks every changed path
2. Deletion found → lease released, artifact saved, awaiting_approval
3. Kaine must explicitly approve before any deleted file is committed

No unapproved deletion is ever committed, pushed, or marked complete.

## Secret Redaction

Before writing to `agent_runs.raw_prompt`, `agent_runs.raw_output`, `artifacts.content`, or `audit_events.payload`:
- Redact values of known secret env keys
- Redact GitHub tokens, JWTs, Postgres URIs, Bearer tokens by pattern

```typescript
const SECRET_ENV_KEYS = [
  'ANTHROPIC_API_KEY', 'TELEGRAM_BOT_TOKEN', 'DATABASE_URL',
  'MIGRATIONS_DATABASE_URL', 'SUPABASE_URL', 'GITHUB_TOKEN',
  'FIRECRAWL_API_KEY', 'RUNNER_REGISTRATION_SECRET', 'CALQEN_BOT_SERVICE_TOKEN',
]
```

Short values (`true`, `3001`, `development`) are never redacted to avoid damaging logs.

## Path Safety (Phase 2)

All file operations are validated to be within the worktree:
```typescript
const resolved = path.resolve(worktreePath, filePath)
const relative = path.relative(worktreePath, resolved)
if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Path escape')
```

## Branch Protection

Runner refuses to operate on: `main`, `master`, `develop`, `production`, `prod`.
