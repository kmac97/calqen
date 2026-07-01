import { eq, sql } from 'drizzle-orm'
import {
  db,
  agentRuns,
  tasks,
  auditEvents,
  redactSecrets,
  calculateCost,
} from '@calqen/shared'
import type { AgentRun } from '@calqen/shared'

export type AgentType = AgentRun['agentType']

export interface AgentResult<T> {
  output: T
  prompt: string
  inputTokens?: number
  outputTokens?: number
  modelUsed?: string
}

export class CancelledError extends Error {
  constructor(taskId: string) { super(`Task ${taskId} cancelled`) }
}

export class BudgetExceededError extends Error {
  constructor(taskId: string) { super(`Budget exceeded for task ${taskId}`) }
}

export interface PartialUsage {
  inputTokens: number
  outputTokens: number
  modelUsed: string
}

// Thrown instead of a bare error when an agent made one or more real, billed model calls before
// ultimately failing (e.g. a retry loop that exhausts all attempts) — lets runAgent still record
// and bill the tokens that were actually spent, instead of silently dropping them from spent_usd.
export class PartialUsageError extends Error {
  constructor(public readonly originalError: unknown, public readonly usage: PartialUsage) {
    super(originalError instanceof Error ? originalError.message : String(originalError))
    this.name = 'PartialUsageError'
  }
}

export async function runAgent<T>(params: {
  taskId: string
  agentType: AgentType
  provider: string
  isMock: boolean
  fn: () => Promise<AgentResult<T>>
}): Promise<T> {
  const { taskId, agentType, provider, isMock, fn } = params

  const [run] = await db.insert(agentRuns).values({ taskId, agentType, provider, isMock, status: 'pending' }).returning()
  if (!run) throw new Error('Failed to create agent run')

  const t0 = Date.now()

  try {
    const [task] = await db
      .select({ cancelRequestedAt: tasks.cancelRequestedAt, spentUsd: tasks.spentUsd, budgetUsd: tasks.budgetUsd })
      .from(tasks)
      .where(eq(tasks.id, taskId))

    if (!task) throw new Error(`Task ${taskId} not found`)
    if (task.cancelRequestedAt) throw new CancelledError(taskId)
    if (!isMock && parseFloat(task.spentUsd) >= parseFloat(task.budgetUsd)) {
      throw new BudgetExceededError(taskId)
    }

    await db.update(agentRuns).set({ status: 'running', startedAt: sql`now()` }).where(eq(agentRuns.id, run.id))
    await db.insert(auditEvents).values({ taskId, agentRunId: run.id, eventType: 'agent.started', payload: { agentType, provider, isMock } })

    const result = await fn()
    const durationMs = Date.now() - t0
    const cost =
      !isMock && result.modelUsed && result.inputTokens != null && result.outputTokens != null
        ? calculateCost(result.modelUsed, result.inputTokens, result.outputTokens)
        : null

    await db.update(agentRuns).set({
      status: 'completed',
      rawPrompt: redactSecrets(result.prompt),
      rawOutput: redactSecrets(JSON.stringify(result.output)),
      inputTokens: result.inputTokens ?? null,
      outputTokens: result.outputTokens ?? null,
      costUsd: cost != null ? cost.toFixed(6) : null,
      durationMs,
      modelUsed: result.modelUsed ?? null,
      completedAt: sql`now()`,
    }).where(eq(agentRuns.id, run.id))

    if (!isMock && cost != null) {
      await db.execute(sql`UPDATE tasks SET spent_usd = spent_usd + ${cost.toFixed(6)}::numeric WHERE id = ${taskId}`)
    }

    await db.insert(auditEvents).values({ taskId, agentRunId: run.id, eventType: 'agent.completed', payload: { agentType, durationMs, cost } })

    return result.output
  } catch (err) {
    const usage = err instanceof PartialUsageError ? err.usage : null
    const cost = !isMock && usage ? calculateCost(usage.modelUsed, usage.inputTokens, usage.outputTokens) : null

    await db.update(agentRuns).set({
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
      inputTokens: usage?.inputTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
      costUsd: cost != null ? cost.toFixed(6) : null,
      modelUsed: usage?.modelUsed ?? null,
      durationMs: Date.now() - t0,
      completedAt: sql`now()`,
    }).where(eq(agentRuns.id, run.id))

    if (!isMock && cost != null) {
      await db.execute(sql`UPDATE tasks SET spent_usd = spent_usd + ${cost.toFixed(6)}::numeric WHERE id = ${taskId}`)
    }

    // Unwrap so callers see the real error type (CancelledError, BudgetExceededError, ...) —
    // PartialUsageError only exists to carry usage info through to this cost-accounting step.
    throw err instanceof PartialUsageError ? err.originalError : err
  }
}
