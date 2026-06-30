import { Hono } from 'hono'
import { eq, desc, sql, and, lt } from 'drizzle-orm'
import {
  db,
  tasks,
  projects,
  taskPlans,
  approvals,
  telegramOutbox,
  telegramConversations,
  auditEvents,
  computeScopeHash,
  planHashPayload,
  createTaskSchema,
  createProjectSchema,
} from '@calqen/shared'
import { botAuth } from '../middleware/botAuth.js'
import { transition } from '../lib/transition.js'
import { queueMessage } from '../lib/outbox.js'

export const botRouter = new Hono()

botRouter.use('*', botAuth)

// POST /api/tasks
botRouter.post('/tasks', async (c) => {
  const body = await c.req.json()
  const parsed = createTaskSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'Invalid request body', details: parsed.error.flatten() }, 400)

  const { rawInput, telegramChatId, telegramMessageId } = parsed.data

  const [task] = await db
    .insert(tasks)
    .values({
      rawInput,
      title: rawInput.slice(0, 100),
      telegramChatId,
      telegramMessageId: telegramMessageId ?? null,
      status: 'draft',
    })
    .returning()

  if (!task) return c.json({ error: 'Failed to create task' }, 500)

  await queueMessage(db, {
    chatId: telegramChatId,
    taskId: task.id,
    messageType: 'task_received',
    content: '📥 Got it. Classifying...',
    dedupeKey: `task:${task.id}:task_received`,
  })

  return c.json({ task }, 201)
})

// GET /api/tasks
botRouter.get('/tasks', async (c) => {
  const rows = await db.select().from(tasks).orderBy(desc(tasks.createdAt)).limit(50)
  return c.json({ tasks: rows })
})

// GET /api/tasks/:id
botRouter.get('/tasks/:id', async (c) => {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, c.req.param('id')))
  if (!task) return c.json({ error: 'Not found' }, 404)
  return c.json({ task })
})

// POST /api/tasks/:id/clarification
botRouter.post('/tasks/:id/clarification', async (c) => {
  const taskId = c.req.param('id')
  const body = await c.req.json()
  const reply = (body as { reply?: unknown }).reply

  if (typeof reply !== 'string' || !reply.trim()) {
    return c.json({ error: 'reply is required' }, 400)
  }

  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId))
  if (!task) return c.json({ error: 'Not found' }, 404)

  // Append clarification to rawInput and return to draft for re-classification
  await db.transaction(async (tx) => {
    await tx
      .update(tasks)
      .set({
        rawInput: `${task.rawInput}\n[clarification]: ${reply}`,
        status: 'draft',
        updatedAt: sql`now()`,
      })
      .where(eq(tasks.id, taskId))

    // Remove conversation state so next message isn't treated as clarification
    await tx.delete(telegramConversations).where(eq(telegramConversations.chatId, task.telegramChatId))

    await tx.insert(auditEvents).values({
      taskId,
      eventType: 'task.clarification_received',
      payload: { reply },
    })
  })

  return c.json({ ok: true })
})

// POST /api/tasks/:id/cancel
botRouter.post('/tasks/:id/cancel', async (c) => {
  const taskId = c.req.param('id')
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId))
  if (!task) return c.json({ error: 'Not found' }, 404)

  const terminal = new Set(['completed', 'failed', 'cancelled', 'needs_human_review'])
  if (terminal.has(task.status)) {
    return c.json({ error: `Cannot cancel task in status ${task.status}` }, 409)
  }

  // If runner has it in_progress, set cancel_requested_at and let runner handle it
  if (task.status === 'in_progress') {
    await db
      .update(tasks)
      .set({ cancelRequestedAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(tasks.id, taskId))
    await db.insert(auditEvents).values({
      taskId,
      eventType: 'task.cancel_requested',
      payload: {},
    })
    return c.json({ ok: true }, 202)
  }

  // Otherwise cancel immediately
  await db.transaction(async (tx) => {
    await tx
      .update(tasks)
      .set({ cancelRequestedAt: sql`now()`, cancelledAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(tasks.id, taskId))

    await transition(tx, taskId, 'cancelled', 'user_cancelled')

    await queueMessage(tx, {
      chatId: task.telegramChatId,
      taskId,
      messageType: 'cancelled',
      content: `🚫 Cancelled — ${task.title}`,
      dedupeKey: `task:${taskId}:cancelled`,
    })
  })

  return c.json({ ok: true }, 202)
})

// POST /api/tasks/:id/approve — verifies scope_hash before approving
botRouter.post('/tasks/:id/approve', async (c) => {
  const taskId = c.req.param('id')

  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId))
  if (!task) return c.json({ error: 'Not found' }, 404)

  const [approval] = await db
    .select()
    .from(approvals)
    .where(and(eq(approvals.taskId, taskId), eq(approvals.status, 'pending')))

  if (!approval) return c.json({ error: 'No pending approval for this task' }, 404)

  const [plan] = await db.select().from(taskPlans).where(eq(taskPlans.taskId, taskId))
  if (!plan) return c.json({ error: 'No plan found for this task' }, 404)

  const currentHash = computeScopeHash(planHashPayload(plan))
  if (currentHash !== approval.scopeHash) {
    return c.json({ error: 'Plan has changed since approval was requested' }, 409)
  }

  await db.transaction(async (tx) => {
    await tx
      .update(approvals)
      .set({ status: 'approved', resolvedAt: sql`now()`, resolvedBy: 'kaine' })
      .where(eq(approvals.id, approval.id))

    if (approval.type === 'deletion') {
      await tx
        .update(tasks)
        .set({
          resumeStage: 'verify',
          assignedRunnerId: null,
          leaseId: null,
          leaseExpiresAt: null,
          updatedAt: sql`now()`,
        })
        .where(eq(tasks.id, taskId))
    }

    await transition(tx, taskId, 'queued', `${approval.type}_approved`)

    await tx.insert(auditEvents).values({
      taskId,
      eventType: 'approval.resolved',
      payload: { approvalId: approval.id, type: approval.type, outcome: 'approved' },
    })
  })

  return c.json({ ok: true })
})

// POST /api/tasks/:id/reject
botRouter.post('/tasks/:id/reject', async (c) => {
  const taskId = c.req.param('id')

  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId))
  if (!task) return c.json({ error: 'Not found' }, 404)

  const [approval] = await db
    .select()
    .from(approvals)
    .where(and(eq(approvals.taskId, taskId), eq(approvals.status, 'pending')))

  if (!approval) return c.json({ error: 'No pending approval for this task' }, 404)

  await db.transaction(async (tx) => {
    await tx
      .update(approvals)
      .set({ status: 'rejected', resolvedAt: sql`now()`, resolvedBy: 'kaine' })
      .where(eq(approvals.id, approval.id))

    await transition(tx, taskId, 'cancelled', `${approval.type}_rejected`)

    await queueMessage(tx, {
      chatId: task.telegramChatId,
      taskId,
      messageType: 'cancelled',
      content: `🚫 Cancelled — ${task.title}`,
      dedupeKey: `task:${taskId}:cancelled`,
    })
  })

  return c.json({ ok: true })
})

// GET /api/projects
botRouter.get('/projects', async (c) => {
  const rows = await db.select().from(projects).where(eq(projects.active, true))
  return c.json({ projects: rows })
})

// POST /api/projects
botRouter.post('/projects', async (c) => {
  const body = await c.req.json()
  const parsed = createProjectSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'Invalid request body', details: parsed.error.flatten() }, 400)

  const [project] = await db
    .insert(projects)
    .values({
      name: parsed.data.name,
      githubRepo: parsed.data.githubRepo,
      githubDefaultBranch: parsed.data.githubDefaultBranch,
      localPath: parsed.data.localPath ?? null,
      stack: parsed.data.stack ?? null,
      settings: parsed.data.settings ?? {},
    })
    .returning()

  return c.json({ project }, 201)
})

// GET /api/bot/pending-messages — atomically claims pending outbox rows
botRouter.get('/bot/pending-messages', async (c) => {
  const messages = await db.transaction(async (tx) => {
    // Reset expired delivery leases
    await tx
      .update(telegramOutbox)
      .set({ status: 'pending', deliveryLeaseId: null, deliveryLeaseExpiresAt: null })
      .where(
        and(
          eq(telegramOutbox.status, 'sending'),
          lt(telegramOutbox.deliveryLeaseExpiresAt, sql`now()`),
        ),
      )

    // Atomically claim pending messages
    const claimed = await tx.execute(sql`
      UPDATE telegram_outbox
      SET status = 'sending',
          delivery_lease_id = gen_random_uuid(),
          delivery_lease_expires_at = now() + interval '30 seconds',
          attempts = attempts + 1
      WHERE id IN (
        SELECT id FROM telegram_outbox
        WHERE status = 'pending'
        ORDER BY created_at ASC
        LIMIT 5
        FOR UPDATE SKIP LOCKED
      )
      RETURNING
        id,
        chat_id AS "chatId",
        task_id AS "taskId",
        message_type AS "messageType",
        content,
        reply_to_message_id AS "replyToMessageId",
        delivery_lease_id AS "deliveryLeaseId"
    `)

    return Array.from(claimed).map((r) => {
      const row = r as Record<string, unknown>
      return {
        id: row['id'] as string,
        chatId: row['chatId'] as number,
        taskId: (row['taskId'] ?? null) as string | null,
        messageType: row['messageType'] as string,
        content: row['content'] as string,
        replyToMessageId: (row['replyToMessageId'] ?? null) as number | null,
        deliveryLeaseId: row['deliveryLeaseId'] as string,
      }
    })
  })

  return c.json({ messages })
})

// GET /api/bot/conversation/:chatId
botRouter.get('/bot/conversation/:chatId', async (c) => {
  const chatId = parseInt(c.req.param('chatId'), 10)
  if (isNaN(chatId)) return c.json({ conversation: null })
  const [conv] = await db
    .select()
    .from(telegramConversations)
    .where(eq(telegramConversations.chatId, chatId))
  return c.json({ conversation: conv ?? null })
})

// POST /api/bot/messages/:id/sent
botRouter.post('/bot/messages/:id/sent', async (c) => {
  const id = c.req.param('id')
  await db
    .update(telegramOutbox)
    .set({ status: 'sent', sentAt: sql`now()` })
    .where(eq(telegramOutbox.id, id))
  return c.json({ ok: true })
})
