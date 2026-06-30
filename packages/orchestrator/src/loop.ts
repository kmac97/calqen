import { eq, sql } from 'drizzle-orm'
import {
  db,
  tasks,
  projects,
  taskPlans,
  approvals,
  artifacts,
  telegramConversations,
  auditEvents,
  redactSecretsDeep,
  queueMessage,
} from '@calqen/shared'
import { classifyTask, synthesisePlan } from './agents/classify.js'
import { architectTask } from './agents/architect.js'
import { researchTask } from './agents/research.js'
import { CancelledError, BudgetExceededError } from './agents/runAgent.js'

const POLL_MS = 5000

async function claimDraft() {
  return db.transaction(async (tx) => {
    const rows = await tx.execute(sql`
      UPDATE tasks
      SET status = 'classifying',
          orchestrator_lease_id = gen_random_uuid(),
          orchestrator_lease_expires_at = now() + interval '120 seconds',
          updated_at = now()
      WHERE id = (
        SELECT id FROM tasks
        WHERE status = 'draft'
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING
        id,
        raw_input AS "rawInput",
        telegram_chat_id AS "telegramChatId",
        telegram_message_id AS "telegramMessageId",
        budget_usd AS "budgetUsd",
        spent_usd AS "spentUsd"
    `)
    return Array.from(rows)[0] as { id: string; rawInput: string; telegramChatId: number; telegramMessageId: number | null } | undefined
  })
}

async function claimClassifiedRunner() {
  return db.transaction(async (tx) => {
    const rows = await tx.execute(sql`
      UPDATE tasks
      SET status = 'planning',
          orchestrator_lease_id = gen_random_uuid(),
          orchestrator_lease_expires_at = now() + interval '120 seconds',
          updated_at = now()
      WHERE id = (
        SELECT id FROM tasks
        WHERE status = 'classified' AND execution_target = 'runner'
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING
        id,
        title,
        goal,
        risk_level AS "riskLevel",
        telegram_chat_id AS "telegramChatId",
        telegram_message_id AS "telegramMessageId"
    `)
    return Array.from(rows)[0] as { id: string; title: string; goal: string; riskLevel: string; telegramChatId: number; telegramMessageId: number | null } | undefined
  })
}

async function claimClassifiedOrchestrator() {
  return db.transaction(async (tx) => {
    const rows = await tx.execute(sql`
      UPDATE tasks
      SET status = 'in_progress',
          orchestrator_lease_id = gen_random_uuid(),
          orchestrator_lease_expires_at = now() + interval '300 seconds',
          updated_at = now()
      WHERE id = (
        SELECT id FROM tasks
        WHERE status = 'classified' AND execution_target = 'orchestrator'
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING
        id,
        title,
        goal,
        telegram_chat_id AS "telegramChatId",
        cancel_requested_at AS "cancelRequestedAt"
    `)
    return Array.from(rows)[0] as { id: string; title: string; goal: string; telegramChatId: number; cancelRequestedAt: string | null } | undefined
  })
}

async function failTask(taskId: string, telegramChatId: number, reason: string, messageType: string, content: string) {
  await db.update(tasks).set({ status: 'failed', updatedAt: sql`now()` }).where(eq(tasks.id, taskId))
  await db.insert(auditEvents).values({ taskId, eventType: 'task.failed', payload: { reason } })
  await queueMessage(db, { chatId: telegramChatId, taskId, messageType, content })
}

async function cancelTask(taskId: string) {
  await db.update(tasks).set({
    status: 'cancelled',
    cancelledAt: sql`now()`,
    orchestratorLeaseId: null,
    orchestratorLeaseExpiresAt: null,
    updatedAt: sql`now()`,
  }).where(eq(tasks.id, taskId))
  await db.insert(auditEvents).values({ taskId, eventType: 'task.cancelled', payload: { reason: 'cancel_requested' } })
}

export async function classifyLoop() {
  const task = await claimDraft()
  if (!task) return

  const shortId = task.id.slice(0, 8)
  console.log(`[classify] claimed task ${shortId}`)

  // Each clarification reply appends a "[clarification]:" marker and resets the task to draft,
  // so this loop re-runs per round — the round number keeps dedupe keys from colliding across rounds.
  const round = (task.rawInput.match(/\[clarification\]:/g) ?? []).length

  try {
    const [task_] = await db.select({ cancelRequestedAt: tasks.cancelRequestedAt }).from(tasks).where(eq(tasks.id, task.id))
    if (task_?.cancelRequestedAt) { await cancelTask(task.id); return }

    await queueMessage(db, { chatId: task.telegramChatId, taskId: task.id, messageType: 'classifying', content: '🔍 Classifying...', dedupeKey: `task:${task.id}:classifying:${round}` })

    const activeProjects = await db.select().from(projects).where(eq(projects.active, true))
    const result = await classifyTask(task.id, task.rawInput, activeProjects)

    // Enforce executionTarget server-side — research always → orchestrator, all else → runner
    const executionTarget: 'orchestrator' | 'runner' = result.taskType === 'research' ? 'orchestrator' : 'runner'

    const projectId = result.projectName
      ? activeProjects.find((p) => p.name === result.projectName)?.id ?? null
      : null

    if (result.clarificationQuestion) {
      await db.transaction(async (tx) => {
        await tx.update(tasks).set({
          status: 'awaiting_clarification',
          title: result.title,
          goal: result.goal,
          taskType: result.taskType,
          executionTarget,
          projectId: projectId ?? null,
          constraints: result.constraints,
          acceptanceCriteria: result.acceptanceCriteria,
          riskLevel: result.riskLevel,
          requiresApproval: result.requiresApproval,
          orchestratorLeaseId: null,
          orchestratorLeaseExpiresAt: null,
          updatedAt: sql`now()`,
        }).where(eq(tasks.id, task.id))

        await tx.insert(telegramConversations).values({
          chatId: task.telegramChatId,
          awaitingTaskId: task.id,
          expectedReplyType: 'clarification',
          state: 'awaiting_clarification',
        }).onConflictDoUpdate({
          target: telegramConversations.chatId,
          set: { awaitingTaskId: task.id, expectedReplyType: 'clarification', state: 'awaiting_clarification', updatedAt: sql`now()` },
        })

        await tx.insert(auditEvents).values({ taskId: task.id, eventType: 'task.status_changed', payload: { from: 'classifying', to: 'awaiting_clarification' } })
      })

      await queueMessage(db, {
        chatId: task.telegramChatId, taskId: task.id,
        messageType: 'clarification_needed',
        content: `❓ ${result.clarificationQuestion}`,
        dedupeKey: `task:${task.id}:clarification:${round}`,
      })
    } else {
      await db.update(tasks).set({
        status: 'classified',
        title: result.title,
        goal: result.goal,
        taskType: result.taskType,
        executionTarget,
        projectId: projectId ?? null,
        constraints: result.constraints,
        acceptanceCriteria: result.acceptanceCriteria,
        riskLevel: result.riskLevel,
        requiresApproval: result.requiresApproval,
        orchestratorLeaseId: null,
        orchestratorLeaseExpiresAt: null,
        updatedAt: sql`now()`,
      }).where(eq(tasks.id, task.id))

      await db.insert(auditEvents).values({ taskId: task.id, eventType: 'task.status_changed', payload: { from: 'classifying', to: 'classified' } })
    }
  } catch (err) {
    if (err instanceof CancelledError) { await cancelTask(task.id); return }
    console.error(`[classify] task ${shortId} failed:`, err)
    await failTask(task.id, task.telegramChatId, String(err), 'failed', `❌ Failed to classify — ${shortId}`)
  }
}

export async function planLoop() {
  const task = await claimClassifiedRunner()
  if (!task) return

  const shortId = task.id.slice(0, 8)
  console.log(`[plan] claimed task ${shortId}`)

  try {
    const [task_] = await db.select({ cancelRequestedAt: tasks.cancelRequestedAt }).from(tasks).where(eq(tasks.id, task.id))
    if (task_?.cancelRequestedAt) { await cancelTask(task.id); return }

    const plan = await architectTask(task.id, task.goal ?? task.title)

    const [check] = await db.select({ cancelRequestedAt: tasks.cancelRequestedAt }).from(tasks).where(eq(tasks.id, task.id))
    if (check?.cancelRequestedAt) { await cancelTask(task.id); return }

    const planMessage = await synthesisePlan(
      task.id,
      { title: task.title, goal: task.goal ?? task.title, riskLevel: task.riskLevel },
      plan,
      shortId,
    )

    await db.transaction(async (tx) => {
      await tx.insert(taskPlans).values({
        taskId: task.id,
        version: plan.version,
        filesAffected: plan.filesAffected,
        proposedChanges: redactSecretsDeep(plan.proposedChanges) as object,
        containsDeletions: plan.containsDeletions,
        risks: plan.risks,
        testPlan: plan.testPlan,
        scopeHash: plan.scopeHash,
        estimatedTokens: plan.estimatedTokens ?? null,
      })

      await tx.insert(approvals).values({
        taskId: task.id,
        type: 'plan_approval',
        planVersion: plan.version,
        scopeHash: plan.scopeHash,
        detail: `Plan for: ${task.title}`,
      })

      await tx.update(tasks).set({
        status: 'awaiting_approval',
        orchestratorLeaseId: null,
        orchestratorLeaseExpiresAt: null,
        updatedAt: sql`now()`,
      }).where(eq(tasks.id, task.id))

      await tx.insert(auditEvents).values({ taskId: task.id, eventType: 'task.status_changed', payload: { from: 'planning', to: 'awaiting_approval' } })
    })

    await queueMessage(db, {
      chatId: task.telegramChatId, taskId: task.id,
      messageType: 'plan_ready',
      content: planMessage,
      dedupeKey: `task:${task.id}:plan_v${plan.version}`,
    })
  } catch (err) {
    if (err instanceof CancelledError) { await cancelTask(task.id); return }
    if (err instanceof BudgetExceededError) {
      await failTask(task.id, task.telegramChatId, String(err), 'budget_exceeded', `💸 Budget limit — ${task.title}`)
      return
    }
    console.error(`[plan] task ${shortId} failed:`, err)
    await failTask(task.id, task.telegramChatId, String(err), 'failed', `❌ Failed to plan — ${shortId}`)
  }
}

export async function researchLoop() {
  const task = await claimClassifiedOrchestrator()
  if (!task) return

  const shortId = task.id.slice(0, 8)
  console.log(`[research] claimed task ${shortId}`)

  try {
    if (task.cancelRequestedAt) { await cancelTask(task.id); return }

    await queueMessage(db, {
      chatId: task.telegramChatId, taskId: task.id,
      messageType: 'in_progress',
      content: `⚙️ Researching — ${shortId}...`,
      dedupeKey: `task:${task.id}:in_progress`,
    })

    const result = await researchTask(task.id, task.goal ?? task.title)

    const [check] = await db.select({ cancelRequestedAt: tasks.cancelRequestedAt }).from(tasks).where(eq(tasks.id, task.id))
    if (check?.cancelRequestedAt) { await cancelTask(task.id); return }

    await db.transaction(async (tx) => {
      await tx.insert(artifacts).values({
        taskId: task.id,
        type: 'research',
        content: JSON.stringify(result),
        metadata: { sources: result.sources.length },
      })

      await tx.update(tasks).set({
        status: 'completed',
        orchestratorLeaseId: null,
        orchestratorLeaseExpiresAt: null,
        updatedAt: sql`now()`,
      }).where(eq(tasks.id, task.id))

      await tx.insert(auditEvents).values({ taskId: task.id, eventType: 'task.status_changed', payload: { from: 'in_progress', to: 'completed' } })
    })

    await queueMessage(db, {
      chatId: task.telegramChatId, taskId: task.id,
      messageType: 'completed',
      content: `✅ Done — ${task.title}\n\n${result.summary}`,
      dedupeKey: `task:${task.id}:completed`,
    })
  } catch (err) {
    if (err instanceof CancelledError) { await cancelTask(task.id); return }
    if (err instanceof BudgetExceededError) {
      await failTask(task.id, task.telegramChatId, String(err), 'budget_exceeded', `💸 Budget limit — ${task.title}`)
      return
    }
    console.error(`[research] task ${shortId} failed:`, err)
    await failTask(task.id, task.telegramChatId, String(err), 'failed', `❌ Failed — ${task.title}`)
  }
}

function startLoop(name: string, fn: () => Promise<void>) {
  const tick = async () => {
    try { await fn() } catch (err) { console.error(`[${name}] unhandled:`, err) }
    setTimeout(() => { void tick() }, POLL_MS)
  }
  void tick()
}

export function startAllLoops() {
  startLoop('classify', classifyLoop)
  startLoop('plan', planLoop)
  startLoop('research', researchLoop)
  console.log('Orchestrator loops started')
}
