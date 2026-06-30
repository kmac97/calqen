import { eq, sql } from 'drizzle-orm'
import { tasks, auditEvents, type DBTransaction } from '@calqen/shared'
import type { Task } from '@calqen/shared'

type TaskStatus = Task['status']

const TERMINAL = new Set<TaskStatus>([
  'completed',
  'failed',
  'cancelled',
  'needs_human_review',
])

// Transitions task status, inserts audit event, and respects cancel_requested_at.
// Must be called within a transaction. Returns the status actually applied.
export async function transition(
  tx: DBTransaction,
  taskId: string,
  to: TaskStatus,
  reason?: string,
): Promise<TaskStatus> {
  const [task] = await tx
    .select({ status: tasks.status, cancelRequestedAt: tasks.cancelRequestedAt })
    .from(tasks)
    .where(eq(tasks.id, taskId))

  if (!task) throw new Error(`Task ${taskId} not found`)

  const effectiveTo: TaskStatus =
    task.cancelRequestedAt !== null && !TERMINAL.has(to) ? 'cancelled' : to

  await tx
    .update(tasks)
    .set({ status: effectiveTo, updatedAt: sql`now()` })
    .where(eq(tasks.id, taskId))

  await tx.insert(auditEvents).values({
    taskId,
    eventType: 'task.status_changed',
    payload: { from: task.status, to: effectiveTo, reason: reason ?? null },
  })

  return effectiveTo
}
