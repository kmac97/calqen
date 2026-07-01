import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateShortId } from './shortid.js'
import { calculateCost } from './costs.js'
import { redactSecrets, redactSecretsDeep } from './redact.js'
import { computeScopeHash, deletionHashPayload } from './hash.js'
import { runnerDeletionDetectedSchema, runnerCompleteSchema } from './schemas/runner.js'
import { researchOutputSchema, researchModelOutputSchema, sourceAnnotationSchema, technicalResearchOutputSchema, technicalResearchModelOutputSchema } from './schemas/agent.js'
import { classificationOutputSchema } from './schemas/task.js'

describe('generateShortId', () => {
  it('returns an 8-char hex string', () => {
    const id = generateShortId()
    expect(id).toMatch(/^[0-9a-f]{8}$/)
  })

  it('returns unique values', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateShortId()))
    expect(ids.size).toBe(100)
  })
})

describe('calculateCost', () => {
  it('calculates sonnet cost correctly', () => {
    const cost = calculateCost('claude-sonnet-4-6', 1_000_000, 1_000_000)
    expect(cost).toBeCloseTo(18.0)
  })

  it('calculates haiku cost correctly', () => {
    const cost = calculateCost('claude-haiku-4-5-20251001', 1_000_000, 1_000_000)
    expect(cost).toBeCloseTo(6.0)
  })

  it('returns 0 for unknown model', () => {
    expect(calculateCost('unknown-model', 1000, 1000)).toBe(0)
  })

  it('handles zero tokens', () => {
    expect(calculateCost('claude-sonnet-4-6', 0, 0)).toBe(0)
  })

  it('handles small token counts', () => {
    const cost = calculateCost('claude-sonnet-4-6', 1000, 500)
    expect(cost).toBeCloseTo((1000 / 1_000_000) * 3.0 + (500 / 1_000_000) * 15.0)
  })
})

describe('redactSecrets', () => {
  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-real-key-value-here-xxxx')
    vi.stubEnv('TELEGRAM_BOT_TOKEN', '1234567890:ABCDEFGHIJKLMNopqrstuvwxyz12345')
    vi.stubEnv('DATABASE_URL', 'postgresql://user:pass@host:5432/db')
    vi.stubEnv('CALQEN_BOT_SERVICE_TOKEN', 'supersecretbottoken12345')
  })

  it('redacts known env key values', () => {
    const result = redactSecrets('key is sk-ant-real-key-value-here-xxxx ok')
    expect(result).toBe('key is [REDACTED_ANTHROPIC_API_KEY] ok')
  })

  it('redacts github tokens', () => {
    const token = 'ghp_' + 'A'.repeat(36)
    const result = redactSecrets(`token: ${token}`)
    expect(result).toBe('token: [REDACTED_GITHUB_TOKEN]')
  })

  it('redacts JWTs', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature123'
    const result = redactSecrets(jwt)
    expect(result).toBe('[REDACTED_JWT]')
  })

  it('redacts postgres URIs', () => {
    const result = redactSecrets('connect to postgres://user:secret@host:5432/db now')
    expect(result).toBe('connect to [REDACTED_POSTGRES_URI] now')
  })

  it('redacts bearer tokens', () => {
    const result = redactSecrets('Authorization: Bearer abc123token')
    expect(result).toBe('Authorization: Bearer [REDACTED]')
  })

  it('does not redact short values like port numbers', () => {
    vi.stubEnv('PORT', '3001')
    const result = redactSecrets('port is 3001')
    // 3001 is 4 chars, below the 8-char threshold, so not redacted
    expect(result).toBe('port is 3001')
  })

  it('does not redact boolean-like values', () => {
    vi.stubEnv('RUNNER_DRY_RUN', 'true')
    const result = redactSecrets('dry run is true')
    expect(result).toBe('dry run is true')
  })
})

describe('redactSecretsDeep', () => {
  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-real-key-value-here-xxxx')
  })

  it('redacts strings in objects', () => {
    const result = redactSecretsDeep({ key: 'sk-ant-real-key-value-here-xxxx' })
    expect((result as Record<string, string>)['key']).toBe('[REDACTED_ANTHROPIC_API_KEY]')
  })

  it('redacts strings in nested objects', () => {
    const result = redactSecretsDeep({ nested: { prompt: 'use sk-ant-real-key-value-here-xxxx' } })
    const nested = (result as Record<string, Record<string, string>>)['nested']
    expect(nested?.['prompt']).toBe('use [REDACTED_ANTHROPIC_API_KEY]')
  })

  it('redacts strings in arrays', () => {
    const result = redactSecretsDeep(['sk-ant-real-key-value-here-xxxx', 'safe'])
    expect(result).toEqual(['[REDACTED_ANTHROPIC_API_KEY]', 'safe'])
  })

  it('passes through numbers and booleans unchanged', () => {
    const result = redactSecretsDeep({ count: 42, flag: true })
    expect(result).toEqual({ count: 42, flag: true })
  })
})

describe('computeScopeHash', () => {
  it('returns a 64-char hex string', () => {
    const hash = computeScopeHash({ a: 1 })
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('produces identical hash for same content regardless of key order', () => {
    const h1 = computeScopeHash({ a: 1, b: 2 })
    const h2 = computeScopeHash({ b: 2, a: 1 })
    expect(h1).toBe(h2)
  })

  it('produces different hash for different content', () => {
    const h1 = computeScopeHash({ a: 1 })
    const h2 = computeScopeHash({ a: 2 })
    expect(h1).not.toBe(h2)
  })

  it('handles nested objects with sorted keys', () => {
    const h1 = computeScopeHash({ files: ['a', 'b'], meta: { z: 1, a: 2 } })
    const h2 = computeScopeHash({ meta: { a: 2, z: 1 }, files: ['a', 'b'] })
    expect(h1).toBe(h2)
  })

  it('treats array order as significant', () => {
    const h1 = computeScopeHash({ files: ['a', 'b'] })
    const h2 = computeScopeHash({ files: ['b', 'a'] })
    expect(h1).not.toBe(h2)
  })
})

// Fix #4/5: runner schemas include builderOutput
describe('runnerDeletionDetectedSchema', () => {
  it('accepts builderOutput field', () => {
    const valid = {
      leaseId: '12345678-1234-4234-b234-123456789012',
      files: ['src/old.ts'],
      builderOutput: JSON.stringify({ filesChanged: [], filesCreated: [], filesModified: [], filesDeleted: ['src/old.ts'], diff: '' }),
    }
    expect(runnerDeletionDetectedSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects missing builderOutput', () => {
    const invalid = { leaseId: '12345678-1234-4234-b234-123456789012', files: ['src/old.ts'] }
    expect(runnerDeletionDetectedSchema.safeParse(invalid).success).toBe(false)
  })
})

describe('runnerCompleteSchema', () => {
  it('accepts builderOutput field', () => {
    const valid = {
      leaseId: '12345678-1234-4234-b234-123456789012',
      diffSummary: '1 file',
      filesChanged: ['src/a.ts'],
      filesCreated: [],
      filesModified: ['src/a.ts'],
      filesDeleted: [],
      testOutput: 'all pass',
      passed: true,
      builderOutput: JSON.stringify({ filesChanged: ['src/a.ts'], filesCreated: [], filesModified: ['src/a.ts'], filesDeleted: [], diff: '---' }),
    }
    expect(runnerCompleteSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects missing builderOutput', () => {
    const invalid = {
      leaseId: '12345678-1234-4234-b234-123456789012',
      diffSummary: '1 file',
      filesChanged: ['src/a.ts'],
      filesCreated: [],
      filesModified: [],
      filesDeleted: [],
      testOutput: 'all pass',
      passed: true,
    }
    expect(runnerCompleteSchema.safeParse(invalid).success).toBe(false)
  })
})

// Fix #6: deletion scope_hash is stable and file-order-independent
describe('deletionHashPayload', () => {
  it('sorts files so hash is stable regardless of input order', () => {
    const h1 = computeScopeHash(deletionHashPayload(['b.ts', 'a.ts'], 'content'))
    const h2 = computeScopeHash(deletionHashPayload(['a.ts', 'b.ts'], 'content'))
    expect(h1).toBe(h2)
  })

  it('produces different hash for different artifact content', () => {
    const h1 = computeScopeHash(deletionHashPayload(['a.ts'], 'content-v1'))
    const h2 = computeScopeHash(deletionHashPayload(['a.ts'], 'content-v2'))
    expect(h1).not.toBe(h2)
  })

  it('produces different hash for different file lists', () => {
    const h1 = computeScopeHash(deletionHashPayload(['a.ts'], 'content'))
    const h2 = computeScopeHash(deletionHashPayload(['b.ts'], 'content'))
    expect(h1).not.toBe(h2)
  })

  it('returns a 64-char hex hash', () => {
    const hash = computeScopeHash(deletionHashPayload(['src/x.ts'], 'some content'))
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('researchOutputSchema', () => {
  const baseRecommendation = {
    name: 'Bookkeeping automation',
    problemSolved: 'Manual reconciliation',
    workflow: 'Connect Xero, auto-categorise',
    requiredTools: ['Xero'],
    evidenceStrength: 'medium' as const,
    targetCustomer: null,
    setupPriceRangeGbp: null,
    monthlyRetainerRangeGbp: null,
    roiModel: null,
    pricingBasis: 'not_applicable' as const,
    easeToSellScore: null,
    profitPotentialScore: null,
    fitForKaineScore: null,
    supportingSourceIndexes: [] as number[],
  }

  const baseOutput = {
    mode: 'commercial' as const,
    executiveSummary: 'Summary',
    sourceGeographyNote: 'All sources are UK trade/industry sites.',
    recommendations: [baseRecommendation],
    fastestOfferToLaunch: 'Bookkeeping automation',
    assumptionsAndCaveats: [],
    sources: [{ url: 'https://example.com/a', title: 'A', relevantExcerpt: 'excerpt', sourceType: 'independent_research' as const }],
  }

  it('accepts a valid payload with offer fields populated and a sourced pricing basis', () => {
    const valid = {
      ...baseOutput,
      recommendations: [{
        ...baseRecommendation,
        evidenceStrength: 'high' as const,
        targetCustomer: 'Solo electricians',
        setupPriceRangeGbp: '£500–£1,500',
        monthlyRetainerRangeGbp: '£100–£300',
        roiModel: {
          roiType: 'profit_roi' as const,
          extraLeadsOrBookingsPerMonth: 10,
          conversionRatePercent: 50,
          avgValuePerConvertedJobGbp: 100,
          monthlyCostGbp: 200,
          calculationNote: 'Based on sourced conversion data.',
        },
        pricingBasis: 'observed_market_range' as const,
        easeToSellScore: 7,
        profitPotentialScore: 8,
        fitForKaineScore: 9,
        supportingSourceIndexes: [0],
      }],
    }
    expect(researchOutputSchema.safeParse(valid).success).toBe(true)
  })

  it('accepts a valid payload with all offer fields null and pricingBasis not_applicable', () => {
    expect(researchOutputSchema.safeParse(baseOutput).success).toBe(true)
  })

  it('accepts a roiModel with partial-null numeric fields (estimate with incomplete data)', () => {
    const valid = {
      ...baseOutput,
      recommendations: [{
        ...baseRecommendation,
        roiModel: {
          roiType: 'revenue_uplift' as const,
          extraLeadsOrBookingsPerMonth: 5,
          conversionRatePercent: null,
          avgValuePerConvertedJobGbp: null,
          monthlyCostGbp: 100,
          calculationNote: 'Conversion rate and job value not available in source material.',
        },
      }],
    }
    expect(researchOutputSchema.safeParse(valid).success).toBe(true)
  })

  it.each(['high', 'medium', 'low', 'estimate_only'] as const)('accepts evidenceStrength=%s', (evidenceStrength) => {
    expect(researchOutputSchema.safeParse({ ...baseOutput, recommendations: [{ ...baseRecommendation, evidenceStrength }] }).success).toBe(true)
  })

  it.each([
    'official_vendor', 'independent_research', 'government_or_trade_body',
    'marketplace_or_review', 'consultancy_or_agency', 'video_or_social',
  ] as const)('accepts sourceType=%s', (sourceType) => {
    expect(researchOutputSchema.safeParse({ ...baseOutput, sources: [{ ...baseOutput.sources[0]!, sourceType }] }).success).toBe(true)
  })

  it('rejects estimate_only evidenceStrength paired with observed_market_range pricing', () => {
    const invalid = {
      ...baseOutput,
      recommendations: [{
        ...baseRecommendation,
        evidenceStrength: 'estimate_only' as const,
        pricingBasis: 'observed_market_range' as const,
        supportingSourceIndexes: [0],
      }],
    }
    expect(researchOutputSchema.safeParse(invalid).success).toBe(false)
  })

  it('rejects a payload missing sourceGeographyNote', () => {
    const { sourceGeographyNote: _omit, ...invalid } = baseOutput
    void _omit
    expect(researchOutputSchema.safeParse(invalid).success).toBe(false)
  })

  it('accepts empty recommendations and sources arrays', () => {
    expect(researchOutputSchema.safeParse({ ...baseOutput, recommendations: [], sources: [] }).success).toBe(true)
  })

  it('rejects a payload missing required top-level fields', () => {
    const invalid = {
      recommendations: baseOutput.recommendations,
      fastestOfferToLaunch: baseOutput.fastestOfferToLaunch,
      assumptionsAndCaveats: baseOutput.assumptionsAndCaveats,
      sources: baseOutput.sources,
    }
    expect(researchOutputSchema.safeParse(invalid).success).toBe(false)
  })

  it('rejects an out-of-range score', () => {
    const invalid = { ...baseOutput, recommendations: [{ ...baseRecommendation, easeToSellScore: 11 }] }
    expect(researchOutputSchema.safeParse(invalid).success).toBe(false)
  })

  it('rejects a non-integer score', () => {
    const invalid = { ...baseOutput, recommendations: [{ ...baseRecommendation, easeToSellScore: 5.5 }] }
    expect(researchOutputSchema.safeParse(invalid).success).toBe(false)
  })

  it('rejects supportingSourceIndexes containing an index out of range for sources', () => {
    const invalid = {
      ...baseOutput,
      recommendations: [{
        ...baseRecommendation,
        pricingBasis: 'estimated_recommendation' as const,
        supportingSourceIndexes: [5],
      }],
    }
    expect(researchOutputSchema.safeParse(invalid).success).toBe(false)
  })

  it('rejects observed_market_range pricing with empty supportingSourceIndexes', () => {
    const invalid = {
      ...baseOutput,
      recommendations: [{ ...baseRecommendation, pricingBasis: 'observed_market_range' as const, supportingSourceIndexes: [] }],
    }
    expect(researchOutputSchema.safeParse(invalid).success).toBe(false)
  })

  it('accepts sourceType "unclassified" on a final source (server-attached fallback value)', () => {
    const valid = { ...baseOutput, sources: [{ ...baseOutput.sources[0]!, sourceType: 'unclassified' as const }] }
    expect(researchOutputSchema.safeParse(valid).success).toBe(true)
  })
})

describe('sourceAnnotationSchema', () => {
  it('accepts a valid annotation', () => {
    const valid = { sourceIndex: 0, sourceType: 'official_vendor', relevantExcerpt: 'excerpt' }
    expect(sourceAnnotationSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects a negative sourceIndex', () => {
    expect(sourceAnnotationSchema.safeParse({ sourceIndex: -1, sourceType: 'official_vendor', relevantExcerpt: 'x' }).success).toBe(false)
  })

  it('rejects an unknown sourceType value', () => {
    expect(sourceAnnotationSchema.safeParse({ sourceIndex: 0, sourceType: 'not_a_real_type', relevantExcerpt: 'x' }).success).toBe(false)
  })
})

describe('researchModelOutputSchema', () => {
  const baseModelOutput = {
    mode: 'commercial' as const,
    executiveSummary: 'Summary',
    sourceGeographyNote: 'All sources are UK trade/industry sites.',
    recommendations: [] as unknown[],
    fastestOfferToLaunch: 'N/A',
    assumptionsAndCaveats: [] as string[],
    sourceAnnotations: [{ sourceIndex: 0, sourceType: 'official_vendor' as const, relevantExcerpt: 'excerpt' }],
  }

  it('accepts sourceAnnotations in place of a full sources[] array', () => {
    expect(researchModelOutputSchema.safeParse(baseModelOutput).success).toBe(true)
  })

  it('accepts sourceAnnotations out of order and with gaps (no count/order constraint at this layer)', () => {
    const valid = { ...baseModelOutput, sourceAnnotations: [
      { sourceIndex: 4, sourceType: 'official_vendor' as const, relevantExcerpt: 'x' },
      { sourceIndex: 0, sourceType: 'video_or_social' as const, relevantExcerpt: 'y' },
    ] }
    expect(researchModelOutputSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects a payload missing sourceAnnotations entirely (the model no longer gets to skip source classification)', () => {
    const invalid = {
      executiveSummary: 'Summary',
      sourceGeographyNote: 'note',
      recommendations: [],
      fastestOfferToLaunch: 'N/A',
      assumptionsAndCaveats: [],
    }
    expect(researchModelOutputSchema.safeParse(invalid).success).toBe(false)
  })
})

describe('classificationOutputSchema', () => {
  const baseClassification = {
    title: 'Compare charting libraries',
    goal: 'Pick a charting library',
    taskType: 'research' as const,
    executionTarget: 'orchestrator' as const,
    projectName: null,
    projectRequired: false,
    clarificationQuestion: null,
    constraints: [] as string[],
    acceptanceCriteria: [] as string[],
    riskLevel: 'low' as const,
    requiresApproval: false,
  }

  it('accepts isTechnicalComparison: true', () => {
    expect(classificationOutputSchema.safeParse({ ...baseClassification, isTechnicalComparison: true }).success).toBe(true)
  })

  it('accepts isTechnicalComparison: false', () => {
    expect(classificationOutputSchema.safeParse({ ...baseClassification, isTechnicalComparison: false }).success).toBe(true)
  })

  it('rejects a payload missing isTechnicalComparison', () => {
    expect(classificationOutputSchema.safeParse(baseClassification).success).toBe(false)
  })

  it('accepts a non-null clarificationQuestion (unclear request → clarification required)', () => {
    const valid = { ...baseClassification, clarificationQuestion: 'Which charting use case — journal analytics or live trading?', isTechnicalComparison: true }
    expect(classificationOutputSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects a payload missing a required field (simulates a truncated/malformed provider response)', () => {
    const { title: _omit, ...invalid } = { ...baseClassification, isTechnicalComparison: false }
    void _omit
    expect(classificationOutputSchema.safeParse(invalid).success).toBe(false)
  })

  it('rejects an invalid taskType enum value (simulates a malformed provider response)', () => {
    const invalid = { ...baseClassification, taskType: 'not_a_real_type', isTechnicalComparison: false }
    expect(classificationOutputSchema.safeParse(invalid).success).toBe(false)
  })

  it('rejects a non-boolean isTechnicalComparison (simulates a malformed provider response)', () => {
    const invalid = { ...baseClassification, isTechnicalComparison: 'true' }
    expect(classificationOutputSchema.safeParse(invalid).success).toBe(false)
  })

  it('rejects raw, unparsed JSON.parse failures upstream of the schema (malformed JSON is never valid input)', () => {
    expect(() => JSON.parse('{not valid json')).toThrow()
  })
})

describe('technicalResearchOutputSchema / technicalResearchModelOutputSchema', () => {
  const baseOption = {
    name: 'Lightweight Charts',
    whyThisFits: 'Purpose-built for financial time-series, canvas-based rendering.',
    keyCapabilities: ['candlestick series', 'time-scale scrolling'],
    licensingNote: 'Apache-2.0',
    evidenceStrength: 'high' as const,
    supportingSourceIndexes: [0],
  }

  const baseTechnicalOutput = {
    mode: 'technical' as const,
    executiveSummary: 'Summary',
    primaryRecommendation: baseOption,
    alternative: { ...baseOption, name: 'amCharts 5', supportingSourceIndexes: [1] },
    keyTradeoffs: ['Lightweight Charts is smaller; amCharts 5 has richer theming.'],
    implementationNote: 'Drop into the existing React chart panel with minimal wiring.',
    notRecommended: [] as Array<{ name: string; reason: string; supportingSourceIndexes: number[] }>,
    assumptionsAndCaveats: [] as string[],
    sources: [
      { url: 'https://tradingview.github.io/lightweight-charts/', title: 'Lightweight Charts docs', relevantExcerpt: 'excerpt', sourceType: 'official_vendor' as const },
      { url: 'https://www.amcharts.com/docs/v5/', title: 'amCharts 5 docs', relevantExcerpt: 'excerpt', sourceType: 'official_vendor' as const },
    ],
  }

  it('accepts a valid payload with primaryRecommendation, alternative, and empty notRecommended', () => {
    expect(technicalResearchOutputSchema.safeParse(baseTechnicalOutput).success).toBe(true)
  })

  it('accepts a null licensingNote when genuinely not applicable', () => {
    const valid = { ...baseTechnicalOutput, primaryRecommendation: { ...baseOption, licensingNote: null } }
    expect(technicalResearchOutputSchema.safeParse(valid).success).toBe(true)
  })

  it('accepts a populated notRecommended list', () => {
    const valid = { ...baseTechnicalOutput, notRecommended: [{ name: 'D3.js', reason: 'Too low-level for the required timeline.', supportingSourceIndexes: [0] }] }
    expect(technicalResearchOutputSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects a payload missing primaryRecommendation', () => {
    const { primaryRecommendation: _omit, ...invalid } = baseTechnicalOutput
    void _omit
    expect(technicalResearchOutputSchema.safeParse(invalid).success).toBe(false)
  })

  it('rejects a payload missing alternative', () => {
    const { alternative: _omit, ...invalid } = baseTechnicalOutput
    void _omit
    expect(technicalResearchOutputSchema.safeParse(invalid).success).toBe(false)
  })

  it('rejects an out-of-range supportingSourceIndexes entry in primaryRecommendation', () => {
    const invalid = { ...baseTechnicalOutput, primaryRecommendation: { ...baseOption, supportingSourceIndexes: [99] } }
    expect(technicalResearchOutputSchema.safeParse(invalid).success).toBe(false)
  })

  it('rejects an out-of-range supportingSourceIndexes entry in alternative', () => {
    const invalid = { ...baseTechnicalOutput, alternative: { ...baseOption, name: 'amCharts 5', supportingSourceIndexes: [99] } }
    expect(technicalResearchOutputSchema.safeParse(invalid).success).toBe(false)
  })

  it('rejects an out-of-range supportingSourceIndexes entry in notRecommended', () => {
    const invalid = { ...baseTechnicalOutput, notRecommended: [{ name: 'D3.js', reason: 'x', supportingSourceIndexes: [99] }] }
    expect(technicalResearchOutputSchema.safeParse(invalid).success).toBe(false)
  })

  it('has no pricing/ROI/geography fields structurally present (commercial framing cannot be injected)', () => {
    const withCommercialFields = { ...baseTechnicalOutput, pricingBasis: 'observed_market_range', roiModel: null, sourceGeographyNote: 'irrelevant' }
    // Zod strips unknown keys by default rather than rejecting — assert the parsed *output* doesn't carry them.
    const result = technicalResearchOutputSchema.safeParse(withCommercialFields)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).not.toHaveProperty('pricingBasis')
      expect(result.data).not.toHaveProperty('roiModel')
      expect(result.data).not.toHaveProperty('sourceGeographyNote')
    }
  })

  it('technicalResearchModelOutputSchema accepts sourceAnnotations in place of sources[]', () => {
    const modelOutput = {
      mode: 'technical' as const,
      executiveSummary: baseTechnicalOutput.executiveSummary,
      primaryRecommendation: baseOption,
      alternative: baseTechnicalOutput.alternative,
      keyTradeoffs: baseTechnicalOutput.keyTradeoffs,
      implementationNote: baseTechnicalOutput.implementationNote,
      notRecommended: baseTechnicalOutput.notRecommended,
      assumptionsAndCaveats: baseTechnicalOutput.assumptionsAndCaveats,
      sourceAnnotations: [
        { sourceIndex: 0, sourceType: 'official_vendor' as const, relevantExcerpt: 'excerpt' },
        { sourceIndex: 1, sourceType: 'official_vendor' as const, relevantExcerpt: 'excerpt' },
      ],
    }
    expect(technicalResearchModelOutputSchema.safeParse(modelOutput).success).toBe(true)
  })
})
