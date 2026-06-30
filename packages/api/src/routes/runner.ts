import { Hono } from 'hono'
import { eq, sql, and, isNotNull } from 'drizzle-orm'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import {
  db,
  tasks,
  runners,
  auditEvents,
  artifacts,
  approvals,
  taskPlans,
  projects,
  runnerRegisterSchema,
  runnerHeartbeatSchema,
  runnerCompleteSchema,
  runnerFailSchema,
  runnerDeletionDetectedSchema,
  runnerProgressSchema,
  redactSecrets,
  computeScopeHash,
  planHashPayload,
} from '@calqen/shared'
import { registrationAuth } from '../middleware/registrationAuth.js'
import { registrationRateLimit } from '../middleware/registrationRateLimit.js'
import { runnerAuth } from '../middleware/runnerAuth.js'
import { transition } from '../lib/transition.js'
import { queueMessage } from '../lib/outbox.js'

export const runnerRouter = new Hono()

// POST /api/runner/register
runnerRouter.post('/register', registrationRateLimit, registrationAuth, async (c) => {
  const body = await c.req.json()
  const parsed = runnerRegisterSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'Invalid request body' }, 400)

  const { name, platform } = parsed.data
  const runnerToken = crypto.randomBytes(32).toString('hex')
  const tokenHash = await bcrypt.hash(runnerToken, 12)

  const [inserted] = await db
    .insert(runners)
    .values({ name, tokenHash, platform, status: 'offline' })
    .returning({ id: runners.id })

  if (!inserted) return c.json({ error: 'Registration failed' }, 500)

  return c.json({ runnerId: inserted.id, runnerToken }, 201)
})

// GET /api/runner/poll — atomic claim with FOR UPDATE SKIP LOCKED
runnerRouter.get('/poll', runnerAuth, async (c) => {
  const runnerId = c.get('runnerId' as never) as string

  const task = await db.transaction(async (tx) => {
    const result = await tx.execute(sql`
      UPDATE tasks
      SET status = 'in_progress',
          assigned_runner_id = ${runnerId}::uuid,
          lease_id = gen_random_uuid(),
          lease_expires_at = now() + interval '60 seconds',
          updated_at = now()
      WHERE id = (
        SELECT id FROM tasks
        WHERE execution_target = 'runner'
          AND status = 'queued'
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, lease_id AS "leaseId"
    `)

    if (result.length === 0) return null
    const row = result[0] as { id: string; leaseId: string }

    const [claimed] = await tx.select().from(tasks).where(eq(tasks.id, row.id))
    if (!claimed) return null

    await tx.insert(auditEvents).values({
      taskId: claimed.id,
      eventType: 'runner.task_claimed',
      payload: { runnerId, leaseId: row.leaseId },
    })

    await tx
      .update(runners)
      .set({ status: 'busy', lastHeartbeatAt: sql`now()` })
      .where(eq(runners.id, runnerId))

    return claimed
  })

  if (!task) return c.json({ task: null }, 200)

  const [project] = task.projectId
    ? await db.select().from(projects).where(eq(projects.id, task.projectId))
    : []

  const [plan] = await db.select().from(taskPlans).where(eq(taskPlans.taskId, task.id))

  // Include stored diff artifact when runner needs to resume from verify stage
  const [diffArtifact] = task.resumeStage === 'verify'
    ? await db.select().from(artifacts).where(and(eq(artifacts.taskId, task.id), eq(artifacts.type, 'diff')))
    : []

  return c.json({ task: { ...task, project: project ?? null, plan: plan ?? null, diffArtifact: diffArtifact ?? null } })
})

// POST /api/runner/heartbeat
runnerRouter.post('/heartbeat', runnerAuth, async (c) => {
  const body = await c.req.json()
  const parsed = runnerHeartbeatSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'Invalid request body' }, 400)

  const { leaseId } = parsed.data
  const runnerId = c.get('runnerId' as never) as string

  const [task] = await db
    .select({ id: tasks.id, leaseId: tasks.leaseId })
    .from(tasks)
    .where(and(eq(tasks.assignedRunnerId, runnerId), isNotNull(tasks.leaseId)))

  if (!task || task.leaseId !== leaseId) {
    return c.json({ error: 'Lease mismatch' }, 409)
  }

  await db
    .update(tasks)
    .set({ leaseExpiresAt: sql`now() + interval '60 seconds'` })
    .where(eq(tasks.id, task.id))

  await db
    .update(runners)
    .set({ lastHeartbeatAt: sql`now()` })
    .where(eq(runners.id, runnerId))

  return c.json({ ok: true })
})

// POST /api/runner/tasks/:id/progress
runnerRouter.post('/tasks/:id/progress', runnerAuth, async (c) => {
  const taskId = c.req.param('id')
  const body = await c.req.json()
  const parsed = runnerProgressSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'Invalid request body' }, 400)

  const { leaseId, stage, message } = parsed.data

  const [task] = await db
    .select({ leaseId: tasks.leaseId })
    .from(tasks)
    .where(eq(tasks.id, taskId))

  if (!task || task.leaseId !== leaseId) return c.json({ error: 'Lease mismatch' }, 409)

  await db.insert(auditEvents).values({
    taskId,
    eventType: 'runner.progress',
    payload: { stage, message: message ?? null },
  })

  return c.json({ ok: true })
})

// POST /api/runner/tasks/:id/deletion-detected
runnerRouter.post('/tasks/:id/deletion-detected', runnerAuth, async (c) => {
  const taskId = c.req.param('id')
  const body = await c.req.json()
  const parsed = runnerDeletionDetectedSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'Invalid request body' }, 400)

  const { leaseId, files, diffContent } = parsed.data

  const [task] = await db
    .select({ leaseId: tasks.leaseId, telegramChatId: tasks.telegramChatId, title: tasks.title })
    .from(tasks)
    .where(eq(tasks.id, taskId))

  if (!task || task.leaseId !== leaseId) return c.json({ error: 'Lease mismatch' }, 409)

  const [plan] = await db.select().from(taskPlans).where(eq(taskPlans.taskId, taskId))
  const scopeHash = plan ? computeScopeHash(planHashPayload(plan)) : ''

  await db.transaction(async (tx) => {
    // Save diff artifact
    await tx.insert(artifacts).values({
      taskId,
      type: 'diff',
      content: redactSecrets(diffContent),
      metadata: { filesDeleted: files },
    })

    // Create deletion approval (partial unique index prevents duplicates)
    await tx.insert(approvals).values({
      taskId,
      type: 'deletion',
      planVersion: plan?.version ?? 1,
      scopeHash,
      detail: `Deletion detected in ${files.length} file(s)`,
      filesToDelete: files,
    })

    // Clear lease fields
    await tx
      .update(tasks)
      .set({
        status: 'awaiting_approval',
        assignedRunnerId: null,
        leaseId: null,
        leaseExpiresAt: null,
        updatedAt: sql`now()`,
      })
      .where(eq(tasks.id, taskId))

    await tx.insert(auditEvents).values({
      taskId,
      eventType: 'task.deletion_detected',
      payload: { files, leaseId },
    })

    const fileList = files.map((f) => `• ${f}`).join('\n')
    const shortId = taskId.slice(0, 8)
    await queueMessage(tx, {
      chatId: task.telegramChatId,
      taskId,
      messageType: 'deletion_found',
      content: `🗑️ Deletion found — ${shortId}\n\nFiles:\n${fileList}\n\n/approve ${taskId}  |  /reject ${taskId}`,
      dedupeKey: `task:${taskId}:deletion_found`,
    })
  })

  return c.json({ ok: true })
})

// POST /api/runner/tasks/:id/complete
runnerRouter.post('/tasks/:id/complete', runnerAuth, async (c) => {
  const taskId = c.req.param('id')
  const body = await c.req.json()
  const parsed = runnerCompleteSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'Invalid request body' }, 400)

  const { leaseId, diffSummary, filesChanged, testOutput, passed } = parsed.data

  const [task] = await db
    .select({ leaseId: tasks.leaseId, telegramChatId: tasks.telegramChatId, title: tasks.title, spentUsd: tasks.spentUsd, budgetUsd: tasks.budgetUsd })
    .from(tasks)
    .where(eq(tasks.id, taskId))

  if (!task || task.leaseId !== leaseId) return c.json({ error: 'Lease mismatch' }, 409)

  await db.transaction(async (tx) => {
    await transition(tx, taskId, passed ? 'completed' : 'failed', 'runner_complete')

    await tx
      .update(tasks)
      .set({ assignedRunnerId: null, leaseId: null, leaseExpiresAt: null })
      .where(eq(tasks.id, taskId))

    await tx
      .update(runners)
      .set({ status: 'online' })
      .where(eq(runners.id, c.get('runnerId' as never) as string))

    const shortId = taskId.slice(0, 8)
    const spent = Number(task.spentUsd).toFixed(4)
    if (passed) {
      await queueMessage(tx, {
        chatId: task.telegramChatId,
        taskId,
        messageType: 'complete',
        content: `✅ Done — ${task.title}\n\nDry-run  |  ${filesChanged.length} files (mock)  |  tests passed (mock)\nSpent: $${spent}  |  Branch: calqen/${shortId} (not pushed — dry-run)\n\nDiff saved. /status ${taskId} to view.`,
        dedupeKey: `task:${taskId}:complete`,
      })
    } else {
      await queueMessage(tx, {
        chatId: task.telegramChatId,
        taskId,
        messageType: 'failed',
        content: `❌ Failed — ${task.title}\nStage: verify  |  Spent: $${spent}\nError: Tests did not pass\n\n/status ${taskId} for log`,
        dedupeKey: `task:${taskId}:failed`,
      })
    }

    await tx.insert(auditEvents).values({
      taskId,
      eventType: passed ? 'task.completed' : 'task.failed',
      payload: { diffSummary, filesChanged: filesChanged.length, testOutput: redactSecrets(testOutput) },
    })
  })

  return c.json({ ok: true })
})

// POST /api/runner/tasks/:id/fail
runnerRouter.post('/tasks/:id/fail', runnerAuth, async (c) => {
  const taskId = c.req.param('id')
  const body = await c.req.json()
  const parsed = runnerFailSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'Invalid request body' }, 400)

  const { leaseId, reason, stage } = parsed.data

  const [task] = await db
    .select({ leaseId: tasks.leaseId, telegramChatId: tasks.telegramChatId, title: tasks.title, spentUsd: tasks.spentUsd })
    .from(tasks)
    .where(eq(tasks.id, taskId))

  if (!task || task.leaseId !== leaseId) return c.json({ error: 'Lease mismatch' }, 409)

  await db.transaction(async (tx) => {
    const targetStatus =
      reason === 'unplanned_protected_path'
        ? 'needs_human_review'
        : reason === 'cancelled_by_user'
          ? 'cancelled'
          : 'failed'

    await transition(tx, taskId, targetStatus, reason)

    await tx
      .update(tasks)
      .set({ assignedRunnerId: null, leaseId: null, leaseExpiresAt: null })
      .where(eq(tasks.id, taskId))

    await tx
      .update(runners)
      .set({ status: 'online' })
      .where(eq(runners.id, c.get('runnerId' as never) as string))

    const shortId = taskId.slice(0, 8)
    const spent = Number(task.spentUsd).toFixed(4)

    if (targetStatus === 'needs_human_review') {
      await queueMessage(tx, {
        chatId: task.telegramChatId,
        taskId,
        messageType: 'unplanned_path',
        content: `⚠️ Needs review — ${task.title}\n\nBuilder touched paths outside the plan.\n\n/status ${taskId} for details`,
        dedupeKey: `task:${taskId}:needs_review`,
      })
    } else if (targetStatus === 'cancelled') {
      await queueMessage(tx, {
        chatId: task.telegramChatId,
        taskId,
        messageType: 'cancelled',
        content: `🚫 Cancelled — ${task.title}`,
        dedupeKey: `task:${taskId}:cancelled`,
      })
    } else {
      await queueMessage(tx, {
        chatId: task.telegramChatId,
        taskId,
        messageType: 'failed',
        content: `❌ Failed — ${task.title}\nStage: ${stage ?? 'unknown'}  |  Spent: $${spent}\nError: ${reason}\n\n/status ${shortId} for log`,
        dedupeKey: `task:${taskId}:failed`,
      })
    }
  })

  return c.json({ ok: true })
})
