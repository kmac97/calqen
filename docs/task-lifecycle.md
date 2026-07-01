# Task Lifecycle

## Status Flow

```
draft
  └─► classifying              (orchestrator atomic claim)
        ├─► awaiting_clarification  (ambiguous project/intent)
        │     └─► classifying       (clarification reply processed)
        ├─► needs_human_review      (classification itself failed — never a silent misclassification)
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
| Classification failed | "🔎 Needs review — couldn't reliably classify this request..." — `classifyLoop`'s catch-all routes straight to `needs_human_review`, not `failed`, so a broken classification call is never mistaken for a real (if generic) classification. |
| Completed (research) | One or more "✅ Done — [title]" messages built by `formatResearchMessages` — includes executive summary, ranked recommendations (pricing/ROI/scores, each labelled with its `pricingBasis`), fastest-offer-to-launch, assumptions/caveats, and sources (title + url). Split into multiple outbox rows (`task:{id}:completed:{i}`) only when content exceeds Telegram's 4096-char limit. |
| Completed (code task) | "✅ Done — [title]..." |
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

The orchestrator's equivalent job (`orchestratorLeaseExpiry`, also 30s interval) resets any task with an expired `orchestrator_lease_id` back to `classified` (or `draft` if it was `classifying`) purely from lease state — it does not check whether the task has already reached a terminal status. Because a second worker can claim and even complete/fail a task before a first, now-stale worker's call finally resolves, every write that transitions a task to `completed`, `failed`, or `cancelled` (`failTask`/`cancelTask` in `packages/orchestrator/src/loop.ts`, plus each loop's own success-path update) is guarded with `WHERE status = <the in-flight status this call believes it's in>`, not just `WHERE id = taskId`. If the guard doesn't match (0 rows updated), the write is a no-op — no audit event, no outbox message — since a fresher worker's write already won. Any new code path that transitions a task to a terminal status must use the same guard, or it can silently clobber a newer worker's state.

## resume_stage

Set to `'verify'` when a task is re-queued after deletion approval. Runner loads stored diff artifact from `artifacts` table and skips directly to VerifierAgent.
