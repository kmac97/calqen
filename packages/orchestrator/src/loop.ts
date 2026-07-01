import { and, eq, sql } from 'drizzle-orm'
import {
  db,
  tasks,
  projects,
  taskPlans,
  approvals,
  artifacts,
  telegramConversations,
  auditEvents,
  redactSecrets,
  redactSecretsDeep,
  queueMessage,
  CLARIFICATION_MARKER,
  TECHNICAL_COMPARISON_MARKER,
} from '@calqen/shared'
import { classifyTask, synthesisePlan } from './agents/classify.js'
import { architectTask } from './agents/architect.js'
import { researchTask } from './agents/research.js'
import { formatResearchMessages } from './agents/researchFormat.js'
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
        raw_input AS "rawInput",
        constraints,
        acceptance_criteria AS "acceptanceCriteria",
        telegram_chat_id AS "telegramChatId",
        cancel_requested_at AS "cancelRequestedAt"
    `)
    return Array.from(rows)[0] as {
      id: string; title: string; goal: string; rawInput: string
      constraints: string[]; acceptanceCriteria: string[]
      telegramChatId: number; cancelRequestedAt: string | null
    } | undefined
  })
}

type InFlightStatus = 'classifying' | 'planning' | 'in_progress'

// Guarded on expectedStatus so a stale worker (its lease already expired and reassigned to a
// different worker by the lease-expiry job) can't clobber a newer worker's state — the write
// only takes effect if the task is still in the status this call believes it's in.
//
// targetStatus defaults to 'failed'; callers whose failure means "the system couldn't reliably
// determine what this task is" (e.g. classification itself breaking) should pass
// 'needs_human_review' instead — a distinct, already-existing terminal state (previously only
// used by the Runner's deletion-review flow) so a broken classification never silently proceeds
// as if it had succeeded with guessed/default values.
async function failTask(
  taskId: string, expectedStatus: InFlightStatus, telegramChatId: number,
  reason: string, messageType: string, content: string,
  targetStatus: 'failed' | 'needs_human_review' = 'failed',
) {
  const updated = await db.update(tasks).set({
    status: targetStatus,
    orchestratorLeaseId: null,
    orchestratorLeaseExpiresAt: null,
    updatedAt: sql`now()`,
  }).where(and(eq(tasks.id, taskId), eq(tasks.status, expectedStatus))).returning({ id: tasks.id })

  if (updated.length === 0) {
    console.log(`[loop] skipped stale failure for task ${taskId.slice(0, 8)} — status changed externally`)
    return
  }

  // redactSecrets: reason is often String(err), which can echo raw provider/request details —
  // never persist that unredacted, even into an audit payload nobody sees on Telegram.
  await db.insert(auditEvents).values({
    taskId,
    eventType: targetStatus === 'needs_human_review' ? 'task.needs_human_review' : 'task.failed',
    payload: { reason: redactSecrets(reason) },
  })
  await queueMessage(db, { chatId: telegramChatId, taskId, messageType, content })
}

async function cancelTask(taskId: string, expectedStatus: InFlightStatus) {
  const updated = await db.update(tasks).set({
    status: 'cancelled',
    cancelledAt: sql`now()`,
    orchestratorLeaseId: null,
    orchestratorLeaseExpiresAt: null,
    updatedAt: sql`now()`,
  }).where(and(eq(tasks.id, taskId), eq(tasks.status, expectedStatus))).returning({ id: tasks.id })

  if (updated.length === 0) {
    console.log(`[loop] skipped stale cancellation for task ${taskId.slice(0, 8)} — status changed externally`)
    return
  }

  await db.insert(auditEvents).values({ taskId, eventType: 'task.cancelled', payload: { reason: 'cancel_requested' } })
}

export async function classifyLoop() {
  const task = await claimDraft()
  if (!task) return

  const shortId = task.id.slice(0, 8)
  console.log(`[classify] claimed task ${shortId}`)

  // Each clarification reply appends a CLARIFICATION_MARKER and resets the task to draft,
  // so this loop re-runs per round — the round number keeps dedupe keys from colliding across rounds.
  const round = task.rawInput.split(CLARIFICATION_MARKER).length - 1

  try {
    const [task_] = await db.select({ cancelRequestedAt: tasks.cancelRequestedAt }).from(tasks).where(eq(tasks.id, task.id))
    if (task_?.cancelRequestedAt) { await cancelTask(task.id, 'classifying'); return }

    await queueMessage(db, { chatId: task.telegramChatId, taskId: task.id, messageType: 'classifying', content: '🔍 Classifying...', dedupeKey: `task:${task.id}:classifying:${round}` })

    const activeProjects = await db.select().from(projects).where(eq(projects.active, true))
    const result = await classifyTask(task.id, task.rawInput, activeProjects)

    // Enforce executionTarget server-side — research always → orchestrator, all else → runner
    const executionTarget: 'orchestrator' | 'runner' = result.taskType === 'research' ? 'orchestrator' : 'runner'

    const projectId = result.projectName
      ? activeProjects.find((p) => p.name === result.projectName)?.id ?? null
      : null

    if (result.clarificationQuestion) {
      const transitioned = await db.transaction(async (tx) => {
        const updated = await tx.update(tasks).set({
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
        }).where(and(eq(tasks.id, task.id), eq(tasks.status, 'classifying'))).returning({ id: tasks.id })

        if (updated.length === 0) return false

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
        return true
      })

      if (!transitioned) { console.log(`[loop] skipped stale classify->clarification for task ${shortId} — status changed externally`); return }

      await queueMessage(db, {
        chatId: task.telegramChatId, taskId: task.id,
        messageType: 'clarification_needed',
        content: `❓ ${result.clarificationQuestion}`,
        dedupeKey: `task:${task.id}:clarification:${round}`,
      })
    } else {
      // tasks.taskType is a real Postgres enum (no free 'technical_comparison' value without a
      // migration) — thread the classifier's technical/commercial judgement through the existing
      // constraints[] column instead, via a shared marker (same pattern as CLARIFICATION_MARKER).
      const constraints = result.isTechnicalComparison
        ? [...result.constraints, TECHNICAL_COMPARISON_MARKER]
        : result.constraints

      const updated = await db.update(tasks).set({
        status: 'classified',
        title: result.title,
        goal: result.goal,
        taskType: result.taskType,
        executionTarget,
        projectId: projectId ?? null,
        constraints,
        acceptanceCriteria: result.acceptanceCriteria,
        riskLevel: result.riskLevel,
        requiresApproval: result.requiresApproval,
        orchestratorLeaseId: null,
        orchestratorLeaseExpiresAt: null,
        updatedAt: sql`now()`,
      }).where(and(eq(tasks.id, task.id), eq(tasks.status, 'classifying'))).returning({ id: tasks.id })

      if (updated.length === 0) { console.log(`[loop] skipped stale classify->classified for task ${shortId} — status changed externally`); return }

      await db.insert(auditEvents).values({ taskId: task.id, eventType: 'task.status_changed', payload: { from: 'classifying', to: 'classified' } })
    }
  } catch (err) {
    if (err instanceof CancelledError) { await cancelTask(task.id, 'classifying'); return }
    console.error(`[classify] task ${shortId} failed:`, err)
    await failTask(
      task.id, 'classifying', task.telegramChatId, String(err),
      'needs_human_review', `🔎 Needs review — couldn't reliably classify this request (${shortId}). A human should take a look.`,
      'needs_human_review',
    )
  }
}

export async function planLoop() {
  const task = await claimClassifiedRunner()
  if (!task) return

  const shortId = task.id.slice(0, 8)
  console.log(`[plan] claimed task ${shortId}`)

  try {
    const [task_] = await db.select({ cancelRequestedAt: tasks.cancelRequestedAt }).from(tasks).where(eq(tasks.id, task.id))
    if (task_?.cancelRequestedAt) { await cancelTask(task.id, 'planning'); return }

    const plan = await architectTask(task.id, task.goal ?? task.title)

    const [check] = await db.select({ cancelRequestedAt: tasks.cancelRequestedAt }).from(tasks).where(eq(tasks.id, task.id))
    if (check?.cancelRequestedAt) { await cancelTask(task.id, 'planning'); return }

    const planMessage = await synthesisePlan(
      task.id,
      { title: task.title, goal: task.goal ?? task.title, riskLevel: task.riskLevel },
      plan,
      shortId,
    )

    const transitioned = await db.transaction(async (tx) => {
      const updated = await tx.update(tasks).set({
        status: 'awaiting_approval',
        orchestratorLeaseId: null,
        orchestratorLeaseExpiresAt: null,
        updatedAt: sql`now()`,
      }).where(and(eq(tasks.id, task.id), eq(tasks.status, 'planning'))).returning({ id: tasks.id })

      if (updated.length === 0) return false

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

      await tx.insert(auditEvents).values({ taskId: task.id, eventType: 'task.status_changed', payload: { from: 'planning', to: 'awaiting_approval' } })
      return true
    })

    if (!transitioned) { console.log(`[loop] skipped stale plan->awaiting_approval for task ${shortId} — status changed externally`); return }

    await queueMessage(db, {
      chatId: task.telegramChatId, taskId: task.id,
      messageType: 'plan_ready',
      content: planMessage,
      dedupeKey: `task:${task.id}:plan_v${plan.version}`,
    })
  } catch (err) {
    if (err instanceof CancelledError) { await cancelTask(task.id, 'planning'); return }
    if (err instanceof BudgetExceededError) {
      await failTask(task.id, 'planning', task.telegramChatId, String(err), 'budget_exceeded', `💸 Budget limit — ${task.title}`)
      return
    }
    console.error(`[plan] task ${shortId} failed:`, err)
    await failTask(task.id, 'planning', task.telegramChatId, String(err), 'failed', `❌ Failed to plan — ${shortId}`)
  }
}

export async function researchLoop() {
  const task = await claimClassifiedOrchestrator()
  if (!task) return

  const shortId = task.id.slice(0, 8)
  console.log(`[research] claimed task ${shortId}`)

  try {
    if (task.cancelRequestedAt) { await cancelTask(task.id, 'in_progress'); return }

    await queueMessage(db, {
      chatId: task.telegramChatId, taskId: task.id,
      messageType: 'in_progress',
      content: `⚙️ Researching — ${shortId}...`,
      dedupeKey: `task:${task.id}:in_progress`,
    })

    const result = await researchTask(task.id, {
      goal: task.goal ?? task.title,
      rawInput: task.rawInput,
      constraints: task.constraints,
      acceptanceCriteria: task.acceptanceCriteria,
    })

    const [check] = await db.select({ cancelRequestedAt: tasks.cancelRequestedAt }).from(tasks).where(eq(tasks.id, task.id))
    if (check?.cancelRequestedAt) { await cancelTask(task.id, 'in_progress'); return }

    const transitioned = await db.transaction(async (tx) => {
      const updated = await tx.update(tasks).set({
        status: 'completed',
        orchestratorLeaseId: null,
        orchestratorLeaseExpiresAt: null,
        updatedAt: sql`now()`,
      }).where(and(eq(tasks.id, task.id), eq(tasks.status, 'in_progress'))).returning({ id: tasks.id })

      if (updated.length === 0) return false

      await tx.insert(artifacts).values({
        taskId: task.id,
        type: 'research',
        content: redactSecrets(JSON.stringify(result)),
        metadata: result.mode === 'commercial'
          ? { mode: result.mode, sources: result.sources.length, recommendations: result.recommendations.length }
          : { mode: result.mode, sources: result.sources.length },
      })

      await tx.insert(auditEvents).values({ taskId: task.id, eventType: 'task.status_changed', payload: { from: 'in_progress', to: 'completed' } })
      return true
    })

    if (!transitioned) { console.log(`[loop] skipped stale research->completed for task ${shortId} — status changed externally`); return }

    const messages = formatResearchMessages(task.title, result)
    for (let i = 0; i < messages.length; i++) {
      await queueMessage(db, {
        chatId: task.telegramChatId, taskId: task.id,
        messageType: 'completed',
        content: messages[i]!,
        dedupeKey: `task:${task.id}:completed:${i}`,
      })
    }
  } catch (err) {
    if (err instanceof CancelledError) { await cancelTask(task.id, 'in_progress'); return }
    if (err instanceof BudgetExceededError) {
      await failTask(task.id, 'in_progress', task.telegramChatId, String(err), 'budget_exceeded', `💸 Budget limit — ${task.title}`)
      return
    }
    console.error(`[research] task ${shortId} failed:`, err)
    await failTask(task.id, 'in_progress', task.telegramChatId, String(err), 'failed', `❌ Failed — ${task.title}`)
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
