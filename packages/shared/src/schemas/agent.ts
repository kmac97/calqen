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

export const researchSourceSchema = z.object({
  url: z.string(),
  title: z.string(),
  relevantExcerpt: z.string(),
})

export const pricingBasisSchema = z.enum([
  'observed_market_range',
  'estimated_recommendation',
  'not_applicable',
])

export const researchRecommendationSchema = z
  .object({
    name: z.string(),
    problemSolved: z.string(),
    workflow: z.string(),
    requiredTools: z.array(z.string()),
    // Offer-specific — null for non-commercial/technical research
    targetCustomer: z.string().nullable(),
    setupPriceRangeGbp: z.string().nullable(),
    monthlyRetainerRangeGbp: z.string().nullable(),
    expectedValueOrRoi: z.string().nullable(),
    pricingBasis: pricingBasisSchema,
    easeToSellScore: z.number().int().min(1).max(10).nullable(),
    profitPotentialScore: z.number().int().min(1).max(10).nullable(),
    fitForKaineScore: z.number().int().min(1).max(10).nullable(),
    // 0-based indices into the top-level sources[] array (validated by researchOutputSchema's refine
    // below, not here) — indices instead of raw URL strings because the model reliably corrupts long
    // URLs when re-citing the same one across multiple recommendations; small integers can't do that.
    supportingSourceIndexes: z.array(z.number().int().min(0)),
  })
  .refine((rec) => rec.pricingBasis !== 'observed_market_range' || rec.supportingSourceIndexes.length > 0, {
    message: 'observed_market_range pricing requires at least one supportingSourceIndexes entry',
    path: ['supportingSourceIndexes'],
  })

export const researchOutputSchema = z
  .object({
    executiveSummary: z.string(),
    recommendations: z.array(researchRecommendationSchema),
    fastestOfferToLaunch: z.string(),
    assumptionsAndCaveats: z.array(z.string()),
    sources: z.array(researchSourceSchema),
  })
  .refine(
    (out) => out.recommendations.every((r) => r.supportingSourceIndexes.every((i) => i < out.sources.length)),
    {
      message: 'every supportingSourceIndexes entry must be a valid index into sources[]',
      path: ['recommendations'],
    },
  )

export type ResearchSource = z.infer<typeof researchSourceSchema>
export type ResearchRecommendation = z.infer<typeof researchRecommendationSchema>
export type ResearchOutput = z.infer<typeof researchOutputSchema>
