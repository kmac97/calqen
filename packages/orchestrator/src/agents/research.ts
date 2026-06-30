import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import FirecrawlApp from '@mendable/firecrawl-js'
import { researchOutputSchema, type ResearchOutput } from '@calqen/shared'
import { runAgent, type AgentResult } from './runAgent.js'

const client = new Anthropic()
const FAST_MODEL = process.env['CALQEN_FAST_MODEL'] ?? 'claude-haiku-4-5-20251001'
const MAX_SOURCES = parseInt(process.env['CALQEN_MAX_RESEARCH_SOURCES'] ?? '5', 10)

export interface ResearchContext {
  goal: string
  rawInput: string
  constraints: string[]
  acceptanceCriteria: string[]
}

export async function researchTask(taskId: string, context: ResearchContext): Promise<ResearchOutput> {
  return runAgent({
    taskId,
    agentType: 'researcher',
    provider: 'firecrawl',
    isMock: false,
    fn: async (): Promise<AgentResult<ResearchOutput>> => {
      const firecrawl = new FirecrawlApp({ apiKey: process.env['FIRECRAWL_API_KEY']! })
      const searchResult = await firecrawl.search(context.goal, { limit: MAX_SOURCES })
      const rawSources = (searchResult.web ?? []).slice(0, MAX_SOURCES) as Array<{
        url?: string; title?: string; description?: string
      }>

      const sourcesText = rawSources
        .map((s) => `URL: ${s.url ?? ''}\nTitle: ${s.title ?? ''}\nExcerpt: ${s.description ?? ''}`.trim())
        .join('\n\n---\n\n')

      const prompt = `You are producing a structured research result for this Calqen task.

User's original request (verbatim): "${context.rawInput}"
Restated goal: "${context.goal}"
Constraints the user specified: ${context.constraints.length ? context.constraints.join('; ') : '(none)'}
Acceptance criteria the user specified: ${context.acceptanceCriteria.length ? context.acceptanceCriteria.join('; ') : '(none)'}

Source material:
${sourcesText}

Rules:
1. Follow the structure implied by the user's original request, constraints, and acceptance criteria exactly — if they asked for ranked offers, pricing, workflows, ROI, tools, and sources, your recommendations must deliver exactly that. Do not produce a generic summary paragraph.
2. Be direct and practical. State conclusions, not hedged generalities.
3. recommendations must be ranked best-first.
4. Only populate targetCustomer, setupPriceRangeGbp, monthlyRetainerRangeGbp, expectedValueOrRoi, easeToSellScore, profitPotentialScore, fitForKaineScore when the research concerns a sellable offer or service. For purely technical/comparison research, set every one of those seven fields to null — do not guess values to fill them in.
5. Clearly separate fact from estimate: only state a number, price, or projection as fact if it is directly present in the source material above. Anything you estimate, infer, or project must be phrased with an explicit qualifier such as "estimated" or "approx.", and listed in assumptionsAndCaveats explaining the basis for the estimate.
6. pricingBasis per recommendation: use "observed_market_range" ONLY when the price/retainer/ROI figures are directly backed by the source material, and in that case supportingSourceUrls must include at least one matching URL from sources. Use "estimated_recommendation" when the figures are your own estimate (also note the estimate and its basis in assumptionsAndCaveats). Use "not_applicable" for non-commercial/technical research.
7. supportingSourceUrls must only contain URLs that also appear in the sources array you return — never invent or reference a URL that isn't in sources.
8. Do not name a specific company, course, programme, tool, or service unless it appears in the source material provided above with a URL. If you reference one, it must also appear in sources with a matching url/title.
9. fastestOfferToLaunch: name the single fastest-to-launch recommendation and a one-line reason. If this research is not about sellable offers, write a short sentence stating that launch-speed ranking does not apply to this query.
10. sources entries must be drawn only from the source material above — url and title verbatim, relevantExcerpt a direct quote or close paraphrase of the provided excerpt, never invented.`

      const message = await client.messages.parse({
        model: FAST_MODEL,
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
        output_config: { format: zodOutputFormat(researchOutputSchema) },
      })

      // message.parsed_output is already validated by zodOutputFormat's internal safeParse (throws on
      // failure). This second explicit parse is the defense-in-depth layer living in our own code.
      const parsed = researchOutputSchema.parse(message.parsed_output)

      return {
        output: parsed,
        prompt,
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        modelUsed: FAST_MODEL,
      }
    },
  })
}
