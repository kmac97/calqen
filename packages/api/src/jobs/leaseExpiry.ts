import { eq, lt, sql, and, isNotNull } from 'drizzle-orm'
import { db, tasks, runners, auditEvents } from '@calqen/shared'
import { queueMessage } from '../lib/outbox.js'

async function runLeaseExpiry(): Promise<void> {
  // Find in_progress runner tasks with expired leases
  const expired = await db
    .select({
      id: tasks.id,
      assignedRunnerId: tasks.assignedRunnerId,
      telegramChatId: tasks.telegramChatId,
      title: tasks.title,
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.status, 'in_progress'),
        isNotNull(tasks.leaseExpiresAt),
        lt(tasks.leaseExpiresAt, sql`now()`),
        isNotNull(tasks.assignedRunnerId),
      ),
    )

  for (const task of expired) {
    await db.transaction(async (tx) => {
      await tx
        .update(tasks)
        .set({
          status: 'queued',
          assignedRunnerId: null,
          leaseId: null,
          leaseExpiresAt: null,
          updatedAt: sql`now()`,
        })
        .where(eq(tasks.id, task.id))

      if (task.assignedRunnerId) {
        await tx
          .update(runners)
          .set({ status: 'offline' })
          .where(eq(runners.id, task.assignedRunnerId))
      }

      await tx.insert(auditEvents).values({
        taskId: task.id,
        eventType: 'runner.lease_expired',
        payload: { runnerId: task.assignedRunnerId },
      })

      await queueMessage(tx, {
        chatId: task.telegramChatId,
        taskId: task.id,
        messageType: 'runner_disconnected',
        content: `⚠️ Runner disconnected — ${task.title}\nTask back in queue. Resumes when runner reconnects.`,
        dedupeKey: `task:${task.id}:runner_disconnected:${Date.now()}`,
      })
    })
  }
}

export function startLeaseExpiryJob(): NodeJS.Timeout {
  return setInterval(() => {
    runLeaseExpiry().catch((err: unknown) => {
      console.error('[lease-expiry] error:', err)
    })
  }, 30_000)
}
