import { describe, it, expect } from 'vitest'
import { buildResearchPrompt, type ResearchPromptContext } from './researchPrompt.js'

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
