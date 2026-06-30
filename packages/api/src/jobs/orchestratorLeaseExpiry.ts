import { eq, lt, sql, and, isNotNull } from 'drizzle-orm'
import { db, tasks, auditEvents } from '@calqen/shared'
import { queueMessage } from '../lib/outbox.js'

async function runOrchestratorLeaseExpiry(): Promise<void> {
  const expired = await db
    .select({
      id: tasks.id,
      status: tasks.status,
      telegramChatId: tasks.telegramChatId,
      title: tasks.title,
    })
    .from(tasks)
    .where(
      and(
        isNotNull(tasks.orchestratorLeaseId),
        isNotNull(tasks.orchestratorLeaseExpiresAt),
        lt(tasks.orchestratorLeaseExpiresAt, sql`now()`),
      ),
    )

  for (const task of expired) {
    // classifying → draft (re-classify from scratch); planning/in_progress → classified (resume from there)
    const resetStatus = task.status === 'classifying' ? 'draft' : 'classified'

    await db.transaction(async (tx) => {
      await tx
        .update(tasks)
        .set({
          status: resetStatus,
          orchestratorLeaseId: null,
          orchestratorLeaseExpiresAt: null,
          updatedAt: sql`now()`,
        })
        .where(eq(tasks.id, task.id))

      await tx.insert(auditEvents).values({
        taskId: task.id,
        eventType: 'orchestrator.lease_expired',
        payload: { from: task.status, to: resetStatus },
      })

      await queueMessage(tx, {
        chatId: task.telegramChatId,
        taskId: task.id,
        messageType: 'orchestrator_retry',
        content: `🔄 Retrying — ${task.title}\nOrchestrator timeout. Task re-queued.`,
        dedupeKey: `task:${task.id}:orchestrator_retry:${Date.now()}`,
      })
    })
  }
}

export function startOrchestratorLeaseExpiryJob(): NodeJS.Timeout {
  return setInterval(() => {
    runOrchestratorLeaseExpiry().catch((err: unknown) => {
      console.error('[orchestrator-lease-expiry] error:', err)
    })
  }, 30_000)
}
