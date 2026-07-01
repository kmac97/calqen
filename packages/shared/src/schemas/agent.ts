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

export const sourceTypeSchema = z.enum([
  'official_vendor',
  'independent_research',
  'government_or_trade_body',
  'marketplace_or_review',
  'consultancy_or_agency',
  'video_or_social',
  // Server-attached fallback when the model's annotations don't cover a given raw source
  // (fewer annotations than sources, or an out-of-range index) — never fabricate a real category.
  'unclassified',
])

export const researchSourceSchema = z.object({
  url: z.string(),
  title: z.string(),
  relevantExcerpt: z.string(),
  sourceType: sourceTypeSchema,
})

export const pricingBasisSchema = z.enum([
  'observed_market_range',
  'estimated_recommendation',
  'not_applicable',
])

export const evidenceStrengthSchema = z.enum(['high', 'medium', 'low', 'estimate_only'])

export const roiTypeSchema = z.enum(['profit_roi', 'revenue_uplift'])

export const roiModelSchema = z.object({
  roiType: roiTypeSchema,
  // Individually nullable so partial data doesn't pressure fabrication — the formatter only
  // computes a numeric ROI% when all four are present; otherwise it shows calculationNote alone.
  extraLeadsOrBookingsPerMonth: z.number().nonnegative().nullable(),
  conversionRatePercent: z.number().min(0).max(100).nullable(),
  // Gross profit per job if roiType is profit_roi, revenue per job if roiType is revenue_uplift.
  avgValuePerConvertedJobGbp: z.number().nonnegative().nullable(),
  monthlyCostGbp: z.number().nonnegative().nullable(),
  calculationNote: z.string(),
}).nullable()

export const researchRecommendationSchema = z
  .object({
    name: z.string(),
    problemSolved: z.string(),
    workflow: z.string(),
    requiredTools: z.array(z.string()),
    evidenceStrength: evidenceStrengthSchema,
    // Offer-specific — null for non-commercial/technical research
    targetCustomer: z.string().nullable(),
    setupPriceRangeGbp: z.string().nullable(),
    monthlyRetainerRangeGbp: z.string().nullable(),
    roiModel: roiModelSchema,
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
  .refine((rec) => rec.evidenceStrength !== 'estimate_only' || rec.pricingBasis !== 'observed_market_range', {
    message: 'estimate_only evidence strength cannot pair with observed_market_range pricing',
    path: ['evidenceStrength'],
  })

// Unrefined base shape, kept separate so researchModelOutputSchema below can .omit() sources —
// z.object().refine() returns a ZodEffects wrapper that .omit() isn't available on.
const researchOutputObjectSchema = z.object({
  // Discriminates ResearchOutput from TechnicalResearchOutput for callers that receive the
  // ResearchResult union (loop.ts, researchFormat.ts) — not a schema-level discriminatedUnion
  // since both final schemas are .refine()-wrapped ZodEffects, which don't compose into one.
  mode: z.literal('commercial'),
  executiveSummary: z.string(),
  // Explicit statement of what the source set actually covers geographically, so UK/regional
  // relevance is never silently implied when the evidence is really US/global.
  sourceGeographyNote: z.string(),
  recommendations: z.array(researchRecommendationSchema),
  fastestOfferToLaunch: z.string(),
  assumptionsAndCaveats: z.array(z.string()),
  sources: z.array(researchSourceSchema),
})

export const researchOutputSchema = researchOutputObjectSchema.refine(
  (out) => out.recommendations.every((r) => r.supportingSourceIndexes.every((i) => i < out.sources.length)),
  {
    message: 'every supportingSourceIndexes entry must be a valid index into sources[]',
    path: ['recommendations'],
  },
)

// Per-source annotation the model returns, keyed by index into the real Firecrawl results —
// never url/title, since the model isn't trusted to preserve source count or order. The server
// builds the final canonical sources[] directly from Firecrawl and attaches these by matching
// sourceIndex (packages/orchestrator/src/agents/researchSources.ts).
export const sourceAnnotationSchema = z.object({
  sourceIndex: z.number().int().min(0),
  sourceType: sourceTypeSchema,
  relevantExcerpt: z.string(),
})

// What the model actually generates via structured outputs — sources[] replaced with
// sourceAnnotations[]. Deliberately has no cross-refine against source count, since the model's
// own claimed source count isn't ground truth; that validation happens server-side against the
// real rawSources.length instead.
export const researchModelOutputSchema = researchOutputObjectSchema.omit({ sources: true }).extend({
  sourceAnnotations: z.array(sourceAnnotationSchema),
})

export type ResearchSource = z.infer<typeof researchSourceSchema>
export type ResearchRecommendation = z.infer<typeof researchRecommendationSchema>
export type ResearchOutput = z.infer<typeof researchOutputSchema>
export type RoiModel = NonNullable<ResearchRecommendation['roiModel']>
export type SourceAnnotation = z.infer<typeof sourceAnnotationSchema>
export type ResearchModelOutput = z.infer<typeof researchModelOutputSchema>

// Technical-comparison research (libraries/frameworks/APIs/tools) — deliberately a separate
// shape from the commercial schema above, not just the same fields nulled out. No pricing, ROI,
// target-customer, fastest-to-launch, or geography fields exist here at all: a technical
// comparison structurally cannot be given commercial framing, rather than relying on the model to
// leave those fields null.
export const technicalOptionSchema = z.object({
  name: z.string(),
  // Why this option fits (primaryRecommendation/alternative) — same field, contextual meaning.
  whyThisFits: z.string(),
  keyCapabilities: z.array(z.string()),
  // The actual stated license (e.g. "MIT", "Apache-2.0", "commercial") when known; null only when
  // genuinely not applicable — never a guess.
  licensingNote: z.string().nullable(),
  evidenceStrength: evidenceStrengthSchema,
  supportingSourceIndexes: z.array(z.number().int().min(0)),
})

export const technicalNotRecommendedSchema = z.object({
  name: z.string(),
  reason: z.string(),
  supportingSourceIndexes: z.array(z.number().int().min(0)),
})

const technicalResearchObjectSchema = z.object({
  mode: z.literal('technical'),
  executiveSummary: z.string(),
  primaryRecommendation: technicalOptionSchema,
  alternative: technicalOptionSchema,
  keyTradeoffs: z.array(z.string()),
  // How the primary recommendation fits the user's stated stack/scale.
  implementationNote: z.string(),
  notRecommended: z.array(technicalNotRecommendedSchema),
  assumptionsAndCaveats: z.array(z.string()),
  sources: z.array(researchSourceSchema),
})

function allTechnicalSourceIndexes(out: z.infer<typeof technicalResearchObjectSchema>): number[] {
  return [
    ...out.primaryRecommendation.supportingSourceIndexes,
    ...out.alternative.supportingSourceIndexes,
    ...out.notRecommended.flatMap((n) => n.supportingSourceIndexes),
  ]
}

export const technicalResearchOutputSchema = technicalResearchObjectSchema.refine(
  (out) => allTechnicalSourceIndexes(out).every((i) => i < out.sources.length),
  {
    message: 'every supportingSourceIndexes entry must be a valid index into sources[]',
    path: ['primaryRecommendation'],
  },
)

export const technicalResearchModelOutputSchema = technicalResearchObjectSchema.omit({ sources: true }).extend({
  sourceAnnotations: z.array(sourceAnnotationSchema),
})

export type TechnicalOption = z.infer<typeof technicalOptionSchema>
export type TechnicalResearchOutput = z.infer<typeof technicalResearchOutputSchema>
export type TechnicalResearchModelOutput = z.infer<typeof technicalResearchModelOutputSchema>

// What researchTask() actually returns — callers (loop.ts, researchFormat.ts) branch on `.mode`.
export type ResearchResult = ResearchOutput | TechnicalResearchOutput
