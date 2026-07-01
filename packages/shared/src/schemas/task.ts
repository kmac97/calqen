import { z } from 'zod'

export const classificationOutputSchema = z.object({
  title: z.string(),
  goal: z.string(),
  taskType: z.enum(['feature', 'research', 'debug', 'review']),
  executionTarget: z.enum(['orchestrator', 'runner']),
  projectName: z.string().nullable(),
  projectRequired: z.boolean(),
  clarificationQuestion: z.string().nullable(),
  constraints: z.array(z.string()),
  acceptanceCriteria: z.array(z.string()),
  riskLevel: z.enum(['low', 'medium', 'high']),
  requiresApproval: z.boolean(),
  // True when this is fundamentally a technical comparison (libraries, frameworks, APIs, tools
  // for a stack decision) rather than a commercial offer/business-idea evaluation or general
  // knowledge research — selects research mode without needing a tasks.taskType migration.
  isTechnicalComparison: z.boolean(),
})

export type ClassificationOutput = z.infer<typeof classificationOutputSchema>

export const createTaskSchema = z.object({
  rawInput: z.string().min(1),
  telegramChatId: z.number().int(),
  telegramMessageId: z.number().int().optional(),
})

export const taskPlanSchema = z.object({
  filesAffected: z.array(z.string()),
  proposedChanges: z.array(
    z.object({
      file: z.string(),
      description: z.string(),
      changeType: z.enum(['create', 'modify', 'delete']),
    }),
  ),
  containsDeletions: z.boolean(),
  risks: z.array(z.string()),
  testPlan: z.string(),
  estimatedTokens: z.number().int().optional(),
})

export type TaskPlan = z.infer<typeof taskPlanSchema>
