import type { ResearchOutput, ResearchRecommendation } from '@calqen/shared'

export const TELEGRAM_MAX_MESSAGE_LENGTH = 4096

// Leaves headroom for an optional "(Part i/N) " prefix added after packing, so every
// returned message stays under TELEGRAM_MAX_MESSAGE_LENGTH even once labelled.
const PACK_LIMIT = TELEGRAM_MAX_MESSAGE_LENGTH - 16

function pricingBasisLabel(basis: ResearchRecommendation['pricingBasis']): string {
  switch (basis) {
    case 'observed_market_range':
      return '📊 Pricing basis: sourced market range'
    case 'estimated_recommendation':
      return '🧮 Pricing basis: estimated'
    case 'not_applicable':
      return 'Pricing basis: not applicable'
  }
}

function renderRecommendation(rec: ResearchRecommendation, rank: number, sources: ResearchOutput['sources']): string {
  const lines = [
    `${rank}. ${rec.name}`,
    `Problem solved: ${rec.problemSolved}`,
    `Workflow: ${rec.workflow}`,
    `Tools: ${rec.requiredTools.length ? rec.requiredTools.join(', ') : '—'}`,
  ]

  if (rec.targetCustomer !== null) lines.push(`Target customer: ${rec.targetCustomer}`)
  if (rec.setupPriceRangeGbp !== null) lines.push(`Setup price: ${rec.setupPriceRangeGbp}`)
  if (rec.monthlyRetainerRangeGbp !== null) lines.push(`Monthly retainer: ${rec.monthlyRetainerRangeGbp}`)
  if (rec.expectedValueOrRoi !== null) lines.push(`Expected value/ROI: ${rec.expectedValueOrRoi}`)
  if (rec.easeToSellScore !== null) lines.push(`Ease to sell: ${rec.easeToSellScore}/10`)
  if (rec.profitPotentialScore !== null) lines.push(`Profit potential: ${rec.profitPotentialScore}/10`)
  if (rec.fitForKaineScore !== null) lines.push(`Fit for Kaine: ${rec.fitForKaineScore}/10`)

  lines.push(pricingBasisLabel(rec.pricingBasis))
  if (rec.pricingBasis !== 'not_applicable') {
    const urls = rec.supportingSourceIndexes.map((i) => sources[i]?.url).filter((u): u is string => u !== undefined)
    lines.push(urls.length ? `Supporting sources: ${urls.join(', ')}` : 'Supporting sources: none — see assumptions & caveats')
  }

  return lines.join('\n')
}

function renderSource(source: ResearchOutput['sources'][number], isFirst: boolean): string {
  const body = `• ${source.title}\n  ${source.url}\n  "${source.relevantExcerpt}"`
  return isFirst ? `📚 Sources:\n${body}` : body
}

function buildBlocks(taskTitle: string, result: ResearchOutput): string[] {
  const blocks: string[] = [`✅ Done — ${taskTitle}\n\n${result.executiveSummary}`]

  result.recommendations.forEach((rec, i) => blocks.push(renderRecommendation(rec, i + 1, result.sources)))

  blocks.push(`🚀 Fastest to launch: ${result.fastestOfferToLaunch}`)

  if (result.assumptionsAndCaveats.length) {
    blocks.push(`⚠️ Assumptions & caveats:\n${result.assumptionsAndCaveats.map((a) => `• ${a}`).join('\n')}`)
  }

  result.sources.forEach((source, i) => blocks.push(renderSource(source, i === 0)))

  return blocks
}

function splitOversizedBlock(block: string): string[] {
  const lines = block.split('\n')
  const chunks: string[] = []
  let current = ''

  for (const line of lines) {
    const candidate = current ? `${current}\n${line}` : line
    if (candidate.length <= PACK_LIMIT) {
      current = candidate
      continue
    }
    if (current) chunks.push(current)
    if (line.length <= PACK_LIMIT) {
      current = line
    } else {
      for (let i = 0; i < line.length; i += PACK_LIMIT) chunks.push(line.slice(i, i + PACK_LIMIT))
      current = ''
    }
  }
  if (current) chunks.push(current)
  return chunks
}

function packBlocks(blocks: string[]): string[] {
  const messages: string[] = []
  let current = ''

  const append = (piece: string) => {
    const candidate = current ? `${current}\n\n${piece}` : piece
    if (candidate.length <= PACK_LIMIT) {
      current = candidate
    } else {
      if (current) messages.push(current)
      current = piece
    }
  }

  for (const block of blocks) {
    if (block.length <= PACK_LIMIT) {
      append(block)
    } else {
      if (current) { messages.push(current); current = '' }
      for (const sub of splitOversizedBlock(block)) append(sub)
    }
  }
  if (current) messages.push(current)
  return messages
}

export function formatResearchMessages(taskTitle: string, result: ResearchOutput): string[] {
  const messages = packBlocks(buildBlocks(taskTitle, result))
  if (messages.length <= 1) return messages
  return messages.map((msg, i) => `(Part ${i + 1}/${messages.length}) ${msg}`)
}
