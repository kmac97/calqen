import { describe, it, expect } from 'vitest'
import { buildResearchPrompt, buildTechnicalResearchPrompt, type ResearchPromptContext } from './researchPrompt.js'

function context(overrides: Partial<ResearchPromptContext> = {}): ResearchPromptContext {
  return {
    goal: 'Find AI automation offers for roofing companies',
    rawInput: 'What AI automation could I sell to roofing companies in Leeds?',
    constraints: ['UK-relevant sources only'],
    acceptanceCriteria: ['Ranked recommendations with pricing and sources'],
    ...overrides,
  }
}

describe('buildResearchPrompt', () => {
  const prompt = buildResearchPrompt(context(), '[0] URL: https://example.com\nTitle: Example\nExcerpt: An example excerpt.')

  it('includes the verbatim rawInput, goal, constraints, and acceptance criteria', () => {
    expect(prompt).toContain('What AI automation could I sell to roofing companies in Leeds?')
    expect(prompt).toContain('Find AI automation offers for roofing companies')
    expect(prompt).toContain('UK-relevant sources only')
    expect(prompt).toContain('Ranked recommendations with pricing and sources')
  })

  it('includes the provided source material', () => {
    expect(prompt).toContain('https://example.com')
    expect(prompt).toContain('An example excerpt.')
  })

  it('instructs evidence-strength grading based on source count/independence, not a vibe check', () => {
    expect(prompt).toMatch(/evidenceStrength/)
    expect(prompt).toMatch(/high.*medium.*low.*estimate_only|not a vibe check/i)
  })

  it('lists all six sourceType categories', () => {
    for (const type of [
      'official_vendor', 'independent_research', 'government_or_trade_body',
      'marketplace_or_review', 'consultancy_or_agency', 'video_or_social',
    ]) {
      expect(prompt).toContain(type)
    }
  })

  it('requires inline citation or an explicit estimate marker for quantified claims', () => {
    expect(prompt).toMatch(/inline/i)
    expect(prompt).toMatch(/\(estimated\)/)
  })

  it('requires sourceGeographyNote to state actual geographic coverage plainly', () => {
    expect(prompt).toContain('sourceGeographyNote')
    expect(prompt).toMatch(/UK/i)
  })

  it('specifies the ROI formula and forbids presenting revenue as profit_roi', () => {
    expect(prompt).toContain('extraLeadsOrBookingsPerMonth')
    expect(prompt).toContain('conversionRatePercent')
    expect(prompt).toContain('avgValuePerConvertedJobGbp')
    expect(prompt).toContain('monthlyCostGbp')
    expect(prompt).toMatch(/profit_roi/)
    expect(prompt).toMatch(/revenue_uplift/)
    expect(prompt).toMatch(/never present a revenue-only calculation as profit_roi/i)
  })

  it('requires merging or explicitly distinguishing materially overlapping recommendations', () => {
    expect(prompt).toMatch(/overlap/i)
    expect(prompt).toMatch(/merge/i)
  })

  it('still requires supportingSourceIndexes to reference indexes, never raw URLs', () => {
    expect(prompt).toMatch(/supportingSourceIndexes/)
    expect(prompt).toMatch(/never write out the URL itself/i)
  })

  it('handles empty constraints/acceptanceCriteria without crashing', () => {
    const result = buildResearchPrompt(context({ constraints: [], acceptanceCriteria: [] }), '')
    expect(result).toContain('(none)')
  })
})

describe('buildTechnicalResearchPrompt', () => {
  const thesisContext: ResearchPromptContext = {
    goal: 'Pick a charting library for Thesis',
    rawInput: 'Compare the best charting libraries for Thesis. Real-time trading-journal analytics charts, not a live-market trading terminal.',
    constraints: ['Must fit the existing React stack'],
    acceptanceCriteria: ['Primary recommendation and one alternative'],
  }
  const prompt = buildTechnicalResearchPrompt(thesisContext, '[0] URL: https://tradingview.github.io/lightweight-charts/\nTitle: Lightweight Charts docs\nExcerpt: Official documentation.')

  it('includes the verbatim rawInput, goal, constraints, and acceptance criteria', () => {
    expect(prompt).toContain(thesisContext.rawInput)
    expect(prompt).toContain(thesisContext.goal)
    expect(prompt).toContain('Must fit the existing React stack')
    expect(prompt).toContain('Primary recommendation and one alternative')
  })

  it('instructs against generalizing the stated use case to a more common cousin of the product category', () => {
    expect(prompt).toMatch(/do not generalize/i)
    expect(prompt).toMatch(/trading-journal analytics/i)
    expect(prompt).toMatch(/live-market trading terminal/i)
  })

  it('prohibits geographic/regional/local-market disclaimers', () => {
    expect(prompt).toMatch(/do not include any geographic|no geographic/i)
    expect(prompt).not.toContain('sourceGeographyNote')
  })

  it('sets an official-source-priority hierarchy for factual technical claims', () => {
    expect(prompt).toMatch(/official documentation/i)
    expect(prompt).toMatch(/official github/i)
    expect(prompt).toMatch(/licensing pages?/i)
    expect(prompt).toMatch(/blogs, reddit, videos/i)
    expect(prompt).toMatch(/secondary context only/i)
  })

  it('prohibits inventing rendering technology, licensing, capability, or performance claims', () => {
    expect(prompt).toMatch(/never invent or assume a rendering technology, license, capability, or performance claim/i)
  })

  it('requires exactly one primaryRecommendation and one alternative, plus notRecommended for rejected options', () => {
    expect(prompt).toContain('primaryRecommendation')
    expect(prompt).toContain('alternative')
    expect(prompt).toContain('notRecommended')
    expect(prompt).toMatch(/exactly one primaryRecommendation.*exactly one alternative/i)
  })

  it('requires an implementation note tying the recommendation to the user\'s stated stack', () => {
    expect(prompt).toContain('implementationNote')
    expect(prompt).toMatch(/stated stack/i)
  })

  it('requires a real licensing note, never a guessed license', () => {
    expect(prompt).toContain('licensingNote')
    expect(prompt).toMatch(/never guess a license/i)
  })

  it('grades evidenceStrength by official-source backing specifically', () => {
    expect(prompt).toMatch(/evidenceStrength/)
    expect(prompt).toMatch(/official docs\/repo\/registry/i)
  })

  it('still requires supportingSourceIndexes to reference indexes, never raw URLs', () => {
    expect(prompt).toMatch(/supportingSourceIndexes/)
    expect(prompt).toMatch(/never write out the URL itself/i)
  })

  it('handles empty constraints/acceptanceCriteria without crashing', () => {
    const result = buildTechnicalResearchPrompt({ ...thesisContext, constraints: [], acceptanceCriteria: [] }, '')
    expect(result).toContain('(none)')
  })
})
