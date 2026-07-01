import { describe, it, expect } from 'vitest'
import type { ResearchOutput, ResearchRecommendation, RoiModel, TechnicalOption, TechnicalResearchOutput } from '@calqen/shared'
import { formatResearchMessages, TELEGRAM_MAX_MESSAGE_LENGTH } from './researchFormat.js'

function roiModel(overrides: Partial<NonNullable<RoiModel>> = {}): NonNullable<RoiModel> {
  return {
    roiType: 'profit_roi',
    extraLeadsOrBookingsPerMonth: null,
    conversionRatePercent: null,
    avgValuePerConvertedJobGbp: null,
    monthlyCostGbp: null,
    calculationNote: 'No sourced figures available for this estimate.',
    ...overrides,
  }
}

function recommendation(overrides: Partial<ResearchRecommendation> = {}): ResearchRecommendation {
  return {
    name: 'Bookkeeping automation for trades',
    problemSolved: 'Manual invoice reconciliation',
    workflow: 'Connect Xero, auto-categorise, weekly client report',
    requiredTools: ['Xero', 'Zapier'],
    evidenceStrength: 'medium',
    targetCustomer: null,
    setupPriceRangeGbp: null,
    monthlyRetainerRangeGbp: null,
    roiModel: null,
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
    mode: 'commercial',
    executiveSummary: 'Three viable offers found for solo trades businesses.',
    sourceGeographyNote: 'All sources are UK trade/industry sites.',
    recommendations: [recommendation()],
    fastestOfferToLaunch: 'Bookkeeping automation — can ship in a week.',
    assumptionsAndCaveats: ['Pricing assumes UK solo-trader market'],
    sources: [{ url: 'https://example.com/a', title: 'Example Source', relevantExcerpt: 'Some excerpt text.', sourceType: 'independent_research' }],
    ...overrides,
  }
}

describe('formatResearchMessages', () => {
  it('returns a single message with title, summary, geography note, recommendation, and sources', () => {
    const messages = formatResearchMessages('Find side-hustle ideas', researchOutput())
    expect(messages).toHaveLength(1)
    const msg = messages[0]!
    expect(msg).toContain('Find side-hustle ideas')
    expect(msg).toContain('Three viable offers found')
    expect(msg).toContain('All sources are UK trade/industry sites.')
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

  it.each([
    ['high', 'Evidence: 🟢 High'],
    ['medium', 'Evidence: 🟡 Medium'],
    ['low', 'Evidence: 🟠 Low'],
    ['estimate_only', 'Evidence: ⚪ Estimate only'],
  ] as const)('renders distinct label for evidenceStrength=%s', (strength, expectedLabel) => {
    const msg = formatResearchMessages('T', researchOutput({ recommendations: [recommendation({ evidenceStrength: strength })] }))[0]!
    expect(msg).toContain(expectedLabel)
  })

  it.each([
    ['official_vendor', '🏢 Official vendor'],
    ['independent_research', '🔬 Independent research'],
    ['government_or_trade_body', '🏛️ Government/trade body'],
    ['marketplace_or_review', '🛒 Marketplace/review'],
    ['consultancy_or_agency', '🤝 Consultancy/agency'],
    ['video_or_social', '📹 Video/social'],
  ] as const)('renders distinct label for sourceType=%s', (sourceType, expectedLabel) => {
    const result = researchOutput({ sources: [{ url: 'https://example.com/a', title: 'A', relevantExcerpt: 'a', sourceType }] })
    const msg = formatResearchMessages('T', result)[0]!
    expect(msg).toContain(expectedLabel)
  })

  it('computes and displays profit ROI% from the four roiModel numbers rather than trusting model arithmetic', () => {
    const result = researchOutput({
      recommendations: [recommendation({
        pricingBasis: 'estimated_recommendation',
        roiModel: roiModel({
          roiType: 'profit_roi',
          extraLeadsOrBookingsPerMonth: 10,
          conversionRatePercent: 50,
          avgValuePerConvertedJobGbp: 100,
          monthlyCostGbp: 200,
          calculationNote: 'Estimated from typical trade job margins.',
        }),
      })],
    })
    // net = 10 * 0.5 * 100 - 200 = 300; roi% = 300/200*100 = 150%
    const msg = formatResearchMessages('T', result)[0]!
    expect(msg).toContain('📈 Profit ROI: ~150%')
    expect(msg).toContain('Estimated from typical trade job margins.')
  })

  it('labels revenue_uplift distinctly from profit_roi', () => {
    const result = researchOutput({
      recommendations: [recommendation({
        roiModel: roiModel({ roiType: 'revenue_uplift', extraLeadsOrBookingsPerMonth: 4, conversionRatePercent: 100, avgValuePerConvertedJobGbp: 50, monthlyCostGbp: 100 }),
      })],
    })
    const msg = formatResearchMessages('T', result)[0]!
    expect(msg).toContain('📈 Revenue uplift: ~')
    expect(msg).not.toContain('📈 Profit ROI')
  })

  it('falls back to calculationNote only when any roiModel number is null', () => {
    const result = researchOutput({
      recommendations: [recommendation({ roiModel: roiModel({ calculationNote: 'Not enough data to model a numeric ROI.' }) })],
    })
    const msg = formatResearchMessages('T', result)[0]!
    expect(msg).toContain('📈 Profit ROI: Not enough data to model a numeric ROI.')
    expect(msg).not.toMatch(/~-?\d+%/)
  })

  it('falls back to calculationNote when monthlyCostGbp is zero (avoids divide-by-zero)', () => {
    const result = researchOutput({
      recommendations: [recommendation({
        roiModel: roiModel({ extraLeadsOrBookingsPerMonth: 5, conversionRatePercent: 50, avgValuePerConvertedJobGbp: 100, monthlyCostGbp: 0, calculationNote: 'Free tool, no monthly cost.' }),
      })],
    })
    const msg = formatResearchMessages('T', result)[0]!
    expect(msg).toContain('📈 Profit ROI: Free tool, no monthly cost.')
    expect(msg).not.toMatch(/Infinity|NaN/)
  })

  it('omits ROI line entirely when roiModel is null', () => {
    const msg = formatResearchMessages('T', researchOutput({ recommendations: [recommendation({ roiModel: null })] }))[0]!
    expect(msg).not.toContain('📈')
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
        { url: 'https://example.com/a', title: 'A', relevantExcerpt: 'a', sourceType: 'independent_research' },
        { url: 'https://example.com/b', title: 'B', relevantExcerpt: 'b', sourceType: 'official_vendor' },
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
      sources: [{ url: 'https://example.com/a', title: 'Long', relevantExcerpt: 'Y'.repeat(10_000), sourceType: 'video_or_social' }],
    })
    const messages = formatResearchMessages('T', result)
    expect(messages.length).toBeGreaterThan(1)
    for (const msg of messages) expect(msg.length).toBeLessThanOrEqual(TELEGRAM_MAX_MESSAGE_LENGTH)
  })
})

// Thesis chart-library case: technical comparison, real-time trading-journal analytics charts
// (not a live-market trading terminal) — regression fixture for the six originally-reported problems.
function technicalOption(overrides: Partial<TechnicalOption> = {}): TechnicalOption {
  return {
    name: 'Lightweight Charts',
    whyThisFits: 'Canvas-based, purpose-built for financial time-series in trading-journal analytics dashboards.',
    keyCapabilities: ['candlestick series', 'time-scale scrolling'],
    licensingNote: 'Apache-2.0',
    evidenceStrength: 'high',
    supportingSourceIndexes: [0],
    ...overrides,
  }
}

function technicalResearchOutput(overrides: Partial<TechnicalResearchOutput> = {}): TechnicalResearchOutput {
  return {
    mode: 'technical',
    executiveSummary: 'For Thesis\'s trading-journal analytics charts, Lightweight Charts is the strongest fit.',
    primaryRecommendation: technicalOption(),
    alternative: technicalOption({ name: 'amCharts 5', licensingNote: 'Commercial (free tier available)', supportingSourceIndexes: [1] }),
    keyTradeoffs: ['Lightweight Charts is smaller and canvas-only; amCharts 5 has richer theming but a larger bundle.'],
    implementationNote: 'Drop into the existing React chart panel; no build changes needed.',
    notRecommended: [{ name: 'D3.js', reason: 'Too low-level for the required timeline without significant custom code.', supportingSourceIndexes: [0] }],
    assumptionsAndCaveats: ['Bundle size figures were not quoted in source excerpts — confirm by installing.'],
    sources: [
      { url: 'https://tradingview.github.io/lightweight-charts/', title: 'Lightweight Charts docs', relevantExcerpt: 'Renders using HTML5 Canvas.', sourceType: 'official_vendor' },
      { url: 'https://www.amcharts.com/docs/v5/', title: 'amCharts 5 docs', relevantExcerpt: 'Licensing and capability overview.', sourceType: 'official_vendor' },
    ],
    ...overrides,
  }
}

describe('formatResearchMessages (technical mode)', () => {
  it('renders no geographic/local-market disclaimer line', () => {
    const msg = formatResearchMessages('Thesis charting libraries', technicalResearchOutput())[0]!
    expect(msg).not.toMatch(/🌍/)
    expect(msg).not.toMatch(/UK|US-based|geographic/i)
  })

  it('renders no commercial pricing/ROI fields anywhere in output', () => {
    const msg = formatResearchMessages('T', technicalResearchOutput())[0]!
    expect(msg).not.toMatch(/Setup price|Monthly retainer|Pricing basis|ROI|Ease to sell|Profit potential/i)
  })

  it('renders exactly one primary recommendation and one alternative', () => {
    const msg = formatResearchMessages('T', technicalResearchOutput())[0]!
    expect(msg).toContain('✅ Recommended: Lightweight Charts')
    expect(msg).toContain('🔁 Alternative: amCharts 5')
  })

  it('renders a not-recommended section for rejected options', () => {
    const msg = formatResearchMessages('T', technicalResearchOutput())[0]!
    expect(msg).toContain('🚫 Not recommended')
    expect(msg).toContain('D3.js')
  })

  it('renders licensing notes for both options', () => {
    const msg = formatResearchMessages('T', technicalResearchOutput())[0]!
    expect(msg).toContain('License: Apache-2.0')
    expect(msg).toContain('License: Commercial (free tier available)')
  })

  it('renders the implementation note', () => {
    const msg = formatResearchMessages('T', technicalResearchOutput())[0]!
    expect(msg).toContain('🛠️ Implementation:')
    expect(msg).toContain('Drop into the existing React chart panel')
  })

  it('does not alter or invent facts in whyThisFits/keyCapabilities text (renders verbatim, no rendering-technology claims added)', () => {
    const msg = formatResearchMessages('T', technicalResearchOutput())[0]!
    expect(msg).toContain('Canvas-based, purpose-built for financial time-series in trading-journal analytics dashboards.')
    expect(msg).not.toMatch(/WebGL/)
  })

  it('never prints the literal string "null" for a null licensingNote', () => {
    const result = technicalResearchOutput({ primaryRecommendation: technicalOption({ licensingNote: null }) })
    const msg = formatResearchMessages('T', result)[0]!
    expect(msg).not.toMatch(/\bnull\b/)
  })

  it('omits key-trade-offs and not-recommended blocks when empty, without crashing', () => {
    const result = technicalResearchOutput({ keyTradeoffs: [], notRecommended: [] })
    const messages = formatResearchMessages('T', result)
    expect(messages).toHaveLength(1)
    expect(messages[0]).not.toContain('⚖️ Key trade-offs')
    expect(messages[0]).not.toContain('🚫 Not recommended')
  })
})
