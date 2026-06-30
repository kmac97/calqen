import { z } from 'zod'

export const runnerRegisterSchema = z.object({
  name: z.string().min(1),
  platform: z.string().min(1),
  registrationSecret: z.string().min(1),
})

export const runnerHeartbeatSchema = z.object({
  runnerId: z.string().uuid(),
  leaseId: z.string().uuid(),
})

export const runnerCompleteSchema = z.object({
  leaseId: z.string().uuid(),
  diffSummary: z.string(),
  filesChanged: z.array(z.string()),
  filesCreated: z.array(z.string()),
  filesModified: z.array(z.string()),
  filesDeleted: z.array(z.string()),
  testOutput: z.string(),
  passed: z.boolean(),
})

export const runnerFailSchema = z.object({
  leaseId: z.string().uuid(),
  reason: z.string(),
  stage: z.string().optional(),
})

export const runnerDeletionDetectedSchema = z.object({
  leaseId: z.string().uuid(),
  files: z.array(z.string()),
  diffContent: z.string(),
})

export const runnerProgressSchema = z.object({
  leaseId: z.string().uuid(),
  stage: z.string(),
  message: z.string().optional(),
})
