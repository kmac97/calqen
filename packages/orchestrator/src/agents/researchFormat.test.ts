import { describe, it, expect } from 'vitest'
import type { ResearchOutput, ResearchRecommendation } from '@calqen/shared'
import { formatResearchMessages, TELEGRAM_MAX_MESSAGE_LENGTH } from './researchFormat.js'

function recommendation(overrides: Partial<ResearchRecommendation> = {}): ResearchRecommendation {
  return {
    name: 'Bookkeeping automation for trades',
    problemSolved: 'Manual invoice reconciliation',
    workflow: 'Connect Xero, auto-categorise, weekly client report',
    requiredTools: ['Xero', 'Zapier'],
    targetCustomer: null,
    setupPriceRangeGbp: null,
    monthlyRetainerRangeGbp: null,
    expectedValueOrRoi: null,
    pricingBasis: 'not_applicable',
    easeToSellScore: null,
    profitPotentialScore: null,
    fitForKaineScore: null,
    supportingSourceIndexes: [],
    ...overrides,
  }
}

function researchOutput(overrides: Partial<ResearchOutput> = {}): ResearchOutput {
  return {
    executiveSummary: 'Three viable offers found for solo trades businesses.',
    recommendations: [recommendation()],
    fastestOfferToLaunch: 'Bookkeeping automation — can ship in a week.',
    assumptionsAndCaveats: ['Pricing assumes UK solo-trader market'],
    sources: [{ url: 'https://example.com/a', title: 'Example Source', relevantExcerpt: 'Some excerpt text.' }],
    ...overrides,
  }
}

describe('formatResearchMessages', () => {
  it('returns a single message with title, summary, recommendation, and sources', () => {
    const messages = formatResearchMessages('Find side-hustle ideas', researchOutput())
    expect(messages).toHaveLength(1)
    const msg = messages[0]!
    expect(msg).toContain('Find side-hustle ideas')
    expect(msg).toContain('Three viable offers found')
    expect(msg).toContain('Bookkeeping automation for trades')
    expect(msg).toContain('Example Source')
    expect(msg).toContain('https://example.com/a')
  })

  it('renders populated offer-specific fields', () => {
    const result = researchOutput({
      recommendations: [
        recommendation({
          targetCustomer: 'Solo electricians',
          setupPriceRangeGbp: '£500–£1,500',
          monthlyRetainerRangeGbp: '£100–£300',
          expectedValueOrRoi: 'Saves ~5h/week',
          pricingBasis: 'observed_market_range',
          easeToSellScore: 7,
          profitPotentialScore: 8,
          fitForKaineScore: 9,
          supportingSourceIndexes: [0],
        }),
      ],
    })
    const msg = formatResearchMessages('T', result)[0]!
    expect(msg).toContain('Solo electricians')
    expect(msg).toContain('£500–£1,500')
    expect(msg).toContain('£100–£300')
    expect(msg).toContain('Saves ~5h/week')
    expect(msg).toContain('7/10')
    expect(msg).toContain('8/10')
    expect(msg).toContain('9/10')
    expect(msg).toContain('https://example.com/a')
  })

  it('never prints the literal string "null" when offer fields are all null', () => {
    const msg = formatResearchMessages('T', researchOutput())[0]!
    expect(msg).not.toMatch(/\bnull\b/)
  })

  it.each([
    ['observed_market_range', '📊 Pricing basis: sourced market range'],
    ['estimated_recommendation', '🧮 Pricing basis: estimated'],
    ['not_applicable', 'Pricing basis: not applicable'],
  ] as const)('renders distinct label for pricingBasis=%s', (basis, expectedLabel) => {
    const result = researchOutput({
      recommendations: [recommendation({ pricingBasis: basis, supportingSourceIndexes: basis === 'observed_market_range' ? [0] : [] })],
    })
    const msg = formatResearchMessages('T', result)[0]!
    expect(msg).toContain(expectedLabel)
  })

  it('shows "no supporting sources" wording when estimated with empty supportingSourceIndexes', () => {
    const result = researchOutput({
      recommendations: [recommendation({ pricingBasis: 'estimated_recommendation', supportingSourceIndexes: [] })],
    })
    const msg = formatResearchMessages('T', result)[0]!
    expect(msg).toContain('Supporting sources: none — see assumptions & caveats')
  })

  it('omits the supporting-sources line entirely for not_applicable', () => {
    const result = researchOutput({ recommendations: [recommendation({ pricingBasis: 'not_applicable' })] })
    const msg = formatResearchMessages('T', result)[0]!
    expect(msg).not.toContain('Supporting sources:')
  })

  it('resolves supportingSourceIndexes to their actual source URLs', () => {
    const result = researchOutput({
      sources: [
        { url: 'https://example.com/a', title: 'A', relevantExcerpt: 'a' },
        { url: 'https://example.com/b', title: 'B', relevantExcerpt: 'b' },
      ],
      recommendations: [recommendation({ pricingBasis: 'observed_market_range', supportingSourceIndexes: [1] })],
    })
    const msg = formatResearchMessages('T', result)[0]!
    expect(msg).toContain('Supporting sources: https://example.com/b')
    expect(msg).not.toContain('Supporting sources: https://example.com/a')
  })

  it('handles empty recommendations and assumptionsAndCaveats without crashing or empty headers', () => {
    const result = researchOutput({ recommendations: [], assumptionsAndCaveats: [] })
    const messages = formatResearchMessages('T', result)
    expect(messages).toHaveLength(1)
    expect(messages[0]).not.toContain('Assumptions & caveats')
  })

  it('produces a single message with no "(Part" prefix for normal-sized output', () => {
    const messages = formatResearchMessages('T', researchOutput())
    expect(messages).toHaveLength(1)
    expect(messages[0]).not.toContain('(Part')
  })

  it('chunks oversized output into multiple labelled messages, each within the limit, without splitting a recommendation', () => {
    const recommendations = Array.from({ length: 30 }, (_, i) =>
      recommendation({
        name: `Offer number ${i}`,
        workflow: 'X'.repeat(300),
        pricingBasis: 'observed_market_range',
        supportingSourceIndexes: [0],
      }),
    )
    const result = researchOutput({ recommendations })
    const messages = formatResearchMessages('T', result)

    expect(messages.length).toBeGreaterThan(1)
    for (const msg of messages) expect(msg.length).toBeLessThanOrEqual(TELEGRAM_MAX_MESSAGE_LENGTH)

    // Each recommendation name appears intact in exactly one message (word-boundary to avoid
    // "Offer number 1" false-matching inside "Offer number 10", "Offer number 11", etc.)
    for (let i = 0; i < recommendations.length; i++) {
      const pattern = new RegExp(`Offer number ${i}\\b`)
      const occurrences = messages.filter((msg) => pattern.test(msg))
      expect(occurrences).toHaveLength(1)
    }

    messages.forEach((msg, i) => expect(msg.startsWith(`(Part ${i + 1}/${messages.length}) `)).toBe(true))
  })

  it('hard-splits a single pathologically long excerpt without producing an oversized message', () => {
    const result = researchOutput({
      sources: [{ url: 'https://example.com/a', title: 'Long', relevantExcerpt: 'Y'.repeat(10_000) }],
    })
    const messages = formatResearchMessages('T', result)
    expect(messages.length).toBeGreaterThan(1)
    for (const msg of messages) expect(msg.length).toBeLessThanOrEqual(TELEGRAM_MAX_MESSAGE_LENGTH)
  })
})
