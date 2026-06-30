# Task Lifecycle

## Status Flow

```
draft
  └─► classifying              (orchestrator atomic claim)
        ├─► awaiting_clarification  (ambiguous project/intent)
        │     └─► classifying       (clarification reply processed)
        └─► classified
              │
              ├─ [execution_target = orchestrator]   (research tasks)
              │     └─► in_progress
              │               └─► completed
              │
              └─ [execution_target = runner]          (code tasks)
                    └─► planning
                          └─► planned
                                └─► awaiting_approval
                                      ├─► queued          (/approve, scope_hash verified)
                                      │     └─► in_progress
                                      │           └─► [diff-policy parser]
                                      │                 ├─► awaiting_approval   (deletions found)
                                      │                 │     ├─► queued (resume_stage='verify')
                                      │                 │     └─► cancelled   (/reject)
                                      │                 ├─► needs_human_review (unplanned protected path)
                                      │                 └─► verifying (clean diff)
                                      │                       ├─► completed
                                      │                       ├─► failed
                                      │                       └─► needs_human_review
                                      └─► cancelled      (/reject)
```

## Every Transition

1. Updates `tasks.status` and `tasks.updated_at`
2. Inserts `audit_events` row: `{ event_type: 'task.status_changed', payload: { from, to, reason } }`
3. Checks `cancel_requested_at` — if set and state non-terminal → `cancelled`

## Outbox Messages per Stage

| Stage | Message |
|---|---|
| Task received | "📥 Got it. Classifying..." |
| Classifying | "🔍 Classifying..." |
| Clarification needed | "❓ [question]" |
| Plan ready | "📐 Plan — [short-id]..." with /approve /reject |
| In progress | "⚙️ Building — [short-id]..." |
| Deletion found | "🗑️ Deletion found — [short-id]..." with /approve /reject |
| Unplanned path | "⚠️ Needs review — [title]..." |
| Completed | "✅ Done — [title]..." |
| Failed | "❌ Failed — [title]..." |
| Budget exceeded | "💸 Budget limit — [title]..." |
| Runner disconnected | "⚠️ Runner disconnected — [title]..." |
| Cancelled | "🚫 Cancelled — [title]" |

## Cancellation

- `/cancel` on any non-terminal task: sets `cancel_requested_at` (202 Accepted)
- If task is `queued` or earlier: transitions immediately to `cancelled`
- If task is `in_progress`: runner checks `cancel_requested_at` before each stage, exits cleanly

A cancelled task never reaches `verifying` or `completed`.

## Lease Expiry

If runner heartbeat stops for 60s:
- Background job (30s interval) finds expired leases
- Clears `assigned_runner_id`, `lease_id`, `lease_expires_at`
- Task → `queued` (will be reclaimed by runner when it reconnects)
- Runner → `offline`
- Outbox: `runner_disconnected` message

## resume_stage

Set to `'verify'` when a task is re-queued after deletion approval. Runner loads stored diff artifact from `artifacts` table and skips directly to VerifierAgent.
