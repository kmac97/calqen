import {
  pgTable,
  pgEnum,
  uuid,
  text,
  boolean,
  integer,
  bigint,
  numeric,
  jsonb,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core'

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' })
import { sql } from 'drizzle-orm'

// ── Enums ──────────────────────────────────────────────────────────────────

export const riskLevelEnum = pgEnum('risk_level', ['low', 'medium', 'high'])

export const taskTypeEnum = pgEnum('task_type', ['feature', 'research', 'debug', 'review'])

export const executionTargetEnum = pgEnum('execution_target', ['orchestrator', 'runner'])

export const taskStatusEnum = pgEnum('task_status', [
  'draft',
  'classifying',
  'awaiting_clarification',
  'classified',
  'planning',
  'planned',
  'awaiting_approval',
  'queued',
  'in_progress',
  'verifying',
  'completed',
  'failed',
  'cancelled',
  'needs_human_review',
])

export const agentTypeEnum = pgEnum('agent_type', [
  'calqen',
  'architect',
  'builder',
  'verifier',
  'researcher',
])

export const agentRunStatusEnum = pgEnum('agent_run_status', [
  'pending',
  'running',
  'completed',
  'failed',
  'timed_out',
])

export const artifactTypeEnum = pgEnum('artifact_type', [
  'plan',
  'diff',
  'test_results',
  'research',
  'log',
])

export const approvalTypeEnum = pgEnum('approval_type', [
  'plan_approval',
  'deletion',
  'deployment',
  'manual_review',
])

export const approvalStatusEnum = pgEnum('approval_status', [
  'pending',
  'approved',
  'rejected',
  'timed_out',
])

export const runnerStatusEnum = pgEnum('runner_status', ['online', 'offline', 'busy'])

export const outboxStatusEnum = pgEnum('outbox_status', ['pending', 'sending', 'sent', 'failed'])

// ── Tables ─────────────────────────────────────────────────────────────────

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: text('name').notNull(),
  githubRepo: text('github_repo').notNull(),
  githubDefaultBranch: text('github_default_branch').notNull().default('main'),
  localPath: text('local_path'),
  stack: text('stack'),
  settings: jsonb('settings').notNull().default(sql`'{}'::jsonb`),
  active: boolean('active').notNull().default(true),
  createdAt: timestamptz('created_at').notNull().default(sql`now()`),
  updatedAt: timestamptz('updated_at').notNull().default(sql`now()`),
})

export const runners = pgTable(
  'runners',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull(),
    platform: text('platform').notNull(),
    status: runnerStatusEnum('status').notNull().default('offline'),
    lastHeartbeatAt: timestamptz('last_heartbeat_at'),
    registeredAt: timestamptz('registered_at').notNull().default(sql`now()`),
  },
  (t) => [uniqueIndex('runners_token_hash_idx').on(t.tokenHash)],
)

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    projectId: uuid('project_id').references(() => projects.id),
    title: text('title').notNull(),
    rawInput: text('raw_input').notNull(),
    goal: text('goal'),
    constraints: text('constraints').array().notNull().default(sql`'{}'::text[]`),
    acceptanceCriteria: text('acceptance_criteria').array().notNull().default(sql`'{}'::text[]`),
    riskLevel: riskLevelEnum('risk_level').notNull().default('medium'),
    taskType: taskTypeEnum('task_type').notNull().default('feature'),
    executionTarget: executionTargetEnum('execution_target').notNull().default('runner'),
    status: taskStatusEnum('status').notNull().default('draft'),
    requiresApproval: boolean('requires_approval').notNull().default(true),
    resumeStage: text('resume_stage'),

    // Spend controls
    budgetUsd: numeric('budget_usd', { precision: 10, scale: 4 }).notNull().default('2.00'),
    spentUsd: numeric('spent_usd', { precision: 10, scale: 4 }).notNull().default('0'),
    cancelRequestedAt: timestamptz('cancel_requested_at'),

    // Runner lease
    assignedRunnerId: uuid('assigned_runner_id').references(() => runners.id),
    leaseId: uuid('lease_id'),
    leaseExpiresAt: timestamptz('lease_expires_at'),

    // Orchestrator lease
    orchestratorLeaseId: uuid('orchestrator_lease_id'),
    orchestratorLeaseExpiresAt: timestamptz('orchestrator_lease_expires_at'),

    // Branch/worktree (Phase 2)
    branchName: text('branch_name'),
    worktreePath: text('worktree_path'),

    // Telegram
    telegramChatId: bigint('telegram_chat_id', { mode: 'number' }).notNull(),
    telegramMessageId: integer('telegram_message_id'),

    // Cancellation
    cancelledAt: timestamptz('cancelled_at'),
    cancellationReason: text('cancellation_reason'),

    createdAt: timestamptz('created_at').notNull().default(sql`now()`),
    updatedAt: timestamptz('updated_at').notNull().default(sql`now()`),
  },
  (t) => [
    index('tasks_status_idx').on(t.status),
    index('tasks_project_id_idx').on(t.projectId),
    index('tasks_telegram_chat_id_idx').on(t.telegramChatId),
    index('tasks_execution_target_status_idx').on(t.executionTarget, t.status),
    index('tasks_assigned_runner_id_idx').on(t.assignedRunnerId),
    index('tasks_orchestrator_lease_id_idx').on(t.orchestratorLeaseId),
  ],
)

export const taskPlans = pgTable('task_plans', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  taskId: uuid('task_id')
    .notNull()
    .unique()
    .references(() => tasks.id),
  version: integer('version').notNull().default(1),
  filesAffected: text('files_affected').array().notNull().default(sql`'{}'::text[]`),
  proposedChanges: jsonb('proposed_changes').notNull().default(sql`'[]'::jsonb`),
  containsDeletions: boolean('contains_deletions').notNull().default(false),
  risks: text('risks').array().notNull().default(sql`'{}'::text[]`),
  testPlan: text('test_plan').notNull(),
  scopeHash: text('scope_hash').notNull(),
  estimatedTokens: integer('estimated_tokens'),
  createdBy: text('created_by').notNull().default('architect-agent'),
  createdAt: timestamptz('created_at').notNull().default(sql`now()`),
})

export const agentRuns = pgTable(
  'agent_runs',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id),
    agentType: agentTypeEnum('agent_type').notNull(),
    provider: text('provider').notNull(),
    isMock: boolean('is_mock').notNull().default(false),
    modelUsed: text('model_used'),
    status: agentRunStatusEnum('status').notNull().default('pending'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    costUsd: numeric('cost_usd', { precision: 10, scale: 6 }),
    durationMs: integer('duration_ms'),
    rawPrompt: text('raw_prompt'),
    rawOutput: text('raw_output'),
    error: text('error'),
    startedAt: timestamptz('started_at'),
    completedAt: timestamptz('completed_at'),
    createdAt: timestamptz('created_at').notNull().default(sql`now()`),
  },
  (t) => [index('agent_runs_task_id_idx').on(t.taskId)],
)

export const artifacts = pgTable('artifacts', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  taskId: uuid('task_id')
    .notNull()
    .references(() => tasks.id),
  agentRunId: uuid('agent_run_id').references(() => agentRuns.id),
  type: artifactTypeEnum('type').notNull(),
  content: text('content').notNull(),
  metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamptz('created_at').notNull().default(sql`now()`),
})

export const approvals = pgTable(
  'approvals',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id),
    type: approvalTypeEnum('type').notNull(),
    status: approvalStatusEnum('status').notNull().default('pending'),
    planVersion: integer('plan_version').notNull(),
    scopeHash: text('scope_hash').notNull(),
    detail: text('detail'),
    filesToDelete: text('files_to_delete').array().notNull().default(sql`'{}'::text[]`),
    requestedAt: timestamptz('requested_at').notNull().default(sql`now()`),
    resolvedAt: timestamptz('resolved_at'),
    resolvedBy: text('resolved_by'),
  },
  // ponytail: partial unique index created via raw SQL in migration — one pending approval per task
)

export const telegramOutbox = pgTable(
  'telegram_outbox',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    chatId: bigint('chat_id', { mode: 'number' }).notNull(),
    taskId: uuid('task_id').references(() => tasks.id),
    messageType: text('message_type').notNull(),
    content: text('content').notNull(),
    replyToMessageId: integer('reply_to_message_id'),
    dedupeKey: text('dedupe_key').unique(),
    status: outboxStatusEnum('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    deliveryLeaseId: uuid('delivery_lease_id'),
    deliveryLeaseExpiresAt: timestamptz('delivery_lease_expires_at'),
    lastError: text('last_error'),
    createdAt: timestamptz('created_at').notNull().default(sql`now()`),
    sentAt: timestamptz('sent_at'),
  },
  (t) => [
    index('telegram_outbox_status_idx').on(t.status),
    index('telegram_outbox_chat_id_idx').on(t.chatId),
    index('telegram_outbox_delivery_lease_id_idx').on(t.deliveryLeaseId),
  ],
)

export const telegramConversations = pgTable('telegram_conversations', {
  chatId: bigint('chat_id', { mode: 'number' }).primaryKey(),
  awaitingTaskId: uuid('awaiting_task_id')
    .notNull()
    .references(() => tasks.id),
  expectedReplyType: text('expected_reply_type').notNull(),
  state: text('state').notNull(),
  updatedAt: timestamptz('updated_at').notNull().default(sql`now()`),
})

export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    taskId: uuid('task_id').references(() => tasks.id),
    agentRunId: uuid('agent_run_id').references(() => agentRuns.id),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamptz('created_at').notNull().default(sql`now()`),
  },
  (t) => [
    index('audit_events_task_id_idx').on(t.taskId),
    index('audit_events_created_at_idx').on(t.createdAt),
  ],
)
