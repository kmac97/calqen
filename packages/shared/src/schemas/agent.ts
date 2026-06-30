import { z } from 'zod'

export const builderOutputSchema = z.object({
  diff: z.string(),
  filesChanged: z.array(z.string()),
  filesCreated: z.array(z.string()),
  filesModified: z.array(z.string()),
  filesDeleted: z.array(z.string()),
})

export type BuilderOutput = z.infer<typeof builderOutputSchema>

export const verifierOutputSchema = z.object({
  passed: z.boolean(),
  testOutput: z.string(),
  summary: z.string(),
})

export type VerifierOutput = z.infer<typeof verifierOutputSchema>

export const researchOutputSchema = z.object({
  summary: z.string(),
  sources: z.array(
    z.object({
      url: z.string(),
      title: z.string(),
      relevantExcerpt: z.string(),
    }),
  ),
})

export type ResearchOutput = z.infer<typeof researchOutputSchema>
