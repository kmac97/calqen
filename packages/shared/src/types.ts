import type { InferSelectModel, InferInsertModel } from 'drizzle-orm'
import type {
  projects,
  tasks,
  taskPlans,
  agentRuns,
  artifacts,
  approvals,
  runners,
  telegramOutbox,
  telegramConversations,
  auditEvents,
} from './schema.js'

export type Project = InferSelectModel<typeof projects>
export type NewProject = InferInsertModel<typeof projects>

export type Task = InferSelectModel<typeof tasks>
export type NewTask = InferInsertModel<typeof tasks>

export type TaskPlanRow = InferSelectModel<typeof taskPlans>
export type NewTaskPlan = InferInsertModel<typeof taskPlans>

export type AgentRun = InferSelectModel<typeof agentRuns>
export type NewAgentRun = InferInsertModel<typeof agentRuns>

export type Artifact = InferSelectModel<typeof artifacts>
export type NewArtifact = InferInsertModel<typeof artifacts>

export type Approval = InferSelectModel<typeof approvals>
export type NewApproval = InferInsertModel<typeof approvals>

export type Runner = InferSelectModel<typeof runners>
export type NewRunner = InferInsertModel<typeof runners>

export type TelegramOutbox = InferSelectModel<typeof telegramOutbox>
export type NewTelegramOutbox = InferInsertModel<typeof telegramOutbox>

export type TelegramConversation = InferSelectModel<typeof telegramConversations>
export type NewTelegramConversation = InferInsertModel<typeof telegramConversations>

export type AuditEvent = InferSelectModel<typeof auditEvents>
export type NewAuditEvent = InferInsertModel<typeof auditEvents>
