import { eq } from 'drizzle-orm'
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import FirecrawlApp from '@mendable/firecrawl-js'
import { db, tasks, researchOutputSchema, type ResearchOutput } from '@calqen/shared'
import { runAgent, CancelledError, PartialUsageError, type AgentResult } from './runAgent.js'
import { envInt } from '../env.js'

const client = new Anthropic()
const FAST_MODEL = process.env['CALQEN_FAST_MODEL'] ?? 'claude-haiku-4-5-20251001'

const MAX_SOURCES = envInt('CALQEN_MAX_RESEARCH_SOURCES', 5)
const MAX_RETRIES = envInt('CALQEN_MAX_AGENT_RETRIES', 2)
const RETRY_DELAY_MS = 1000

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
        .map((s, i) => `[${i}] URL: ${s.url ?? ''}\nTitle: ${s.title ?? ''}\nExcerpt: ${s.description ?? ''}`.trim())
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
6. pricingBasis per recommendation: use "observed_market_range" ONLY when the price/retainer/ROI figures are directly backed by the source material, and in that case supportingSourceIndexes must include at least one index from the source material. Use "estimated_recommendation" when the figures are your own estimate (also note the estimate and its basis in assumptionsAndCaveats). Use "not_applicable" for non-commercial/technical research.
7. supportingSourceIndexes is an array of integers — each entry is the [N] index number of a source in the source material above (e.g. [0], [1]). Reference sources by their index number only; never write out the URL itself in this field, and never invent an index that isn't listed above.
8. Do not name a specific company, course, programme, tool, or service unless it appears in the source material provided above with a URL. If you reference one, it must also appear in sources with a matching url/title.
9. fastestOfferToLaunch: name the single fastest-to-launch recommendation and a one-line reason. If this research is not about sellable offers, write a short sentence stating that launch-speed ranking does not apply to this query.
10. Your returned sources array must contain exactly the source material items above, in the same [N] order, starting at index 0 — this keeps supportingSourceIndexes valid. url and title verbatim, relevantExcerpt a direct quote or close paraphrase of the provided excerpt, never invented.`

      // Retry generation rather than fail the whole task over one bad field (e.g. an out-of-range
      // source index, or truncated JSON if the response ran long). Uses messages.create (not the
      // .parse() convenience wrapper) so message.usage is available even when our own parse/validate
      // step below throws, letting every real, billed attempt's tokens be counted toward spend.
      let lastError: unknown
      let totalInputTokens = 0
      let totalOutputTokens = 0

      for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
        const [current] = await db.select({ cancelRequestedAt: tasks.cancelRequestedAt }).from(tasks).where(eq(tasks.id, taskId))
        if (current?.cancelRequestedAt) {
          throw new PartialUsageError(new CancelledError(taskId), {
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
            modelUsed: FAST_MODEL,
          })
        }

        try {
          const message = await client.messages.create({
            model: FAST_MODEL,
            max_tokens: 8192,
            messages: [{ role: 'user', content: prompt }],
            output_config: { format: zodOutputFormat(researchOutputSchema) },
          })

          totalInputTokens += message.usage.input_tokens
          totalOutputTokens += message.usage.output_tokens

          const block = message.content.find((b) => b.type === 'text')
          if (!block || block.type !== 'text') throw new Error('No text block in research response')

          const parsed = researchOutputSchema.parse(JSON.parse(block.text))

          // Trust our own scraped data over the model's transcription for url/title — the one
          // thing that broke this earlier was relying on the model to copy long strings correctly.
          parsed.sources.forEach((source, i) => {
            const original = rawSources[i]
            if (original?.url) source.url = original.url
            if (original?.title) source.title = original.title
          })

          return {
            output: parsed,
            prompt,
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
            modelUsed: FAST_MODEL,
          }
        } catch (err) {
          lastError = err
          if (attempt <= MAX_RETRIES) await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt))
        }
      }

      throw new PartialUsageError(lastError, {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        modelUsed: FAST_MODEL,
      })
    },
  })
}
