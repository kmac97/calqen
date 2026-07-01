import { eq } from 'drizzle-orm'
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import FirecrawlApp from '@mendable/firecrawl-js'
import {
  db, tasks,
  researchOutputSchema, researchModelOutputSchema,
  technicalResearchOutputSchema, technicalResearchModelOutputSchema,
  TECHNICAL_COMPARISON_MARKER,
  type ResearchResult,
} from '@calqen/shared'
import { runAgent, CancelledError, PartialUsageError, type AgentResult } from './runAgent.js'
import { buildResearchPrompt, buildTechnicalResearchPrompt } from './researchPrompt.js'
import { reconcileSources, allIndexesValid, type RawSource } from './researchSources.js'
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

export async function researchTask(taskId: string, context: ResearchContext): Promise<ResearchResult> {
  return runAgent({
    taskId,
    agentType: 'researcher',
    provider: 'firecrawl',
    isMock: false,
    fn: async (): Promise<AgentResult<ResearchResult>> => {
      // tasks.constraints carries this marker instead of a tasks.taskType enum value (which would
      // need a migration) — strip it before the model ever sees the constraints list.
      const isTechnical = context.constraints.includes(TECHNICAL_COMPARISON_MARKER)
      const promptContext = { ...context, constraints: context.constraints.filter((c) => c !== TECHNICAL_COMPARISON_MARKER) }

      // For technical comparisons, bias the search toward official docs/GitHub/licensing pages —
      // a bare goal query tends to surface "best X libraries" comparison blogs instead, which is
      // exactly the source-authority problem the technical prompt is meant to avoid.
      const searchQuery = isTechnical ? `${context.goal} official documentation GitHub license` : context.goal
      const firecrawl = new FirecrawlApp({ apiKey: process.env['FIRECRAWL_API_KEY']! })
      const searchResult = await firecrawl.search(searchQuery, { limit: MAX_SOURCES })
      const rawSources: RawSource[] = (searchResult.web ?? []).slice(0, MAX_SOURCES) as RawSource[]

      const sourcesText = rawSources
        .map((s, i) => `[${i}] URL: ${s.url ?? ''}\nTitle: ${s.title ?? ''}\nExcerpt: ${s.description ?? ''}`.trim())
        .join('\n\n---\n\n')

      const prompt = isTechnical
        ? buildTechnicalResearchPrompt(promptContext, sourcesText)
        : buildResearchPrompt(promptContext, sourcesText)

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
            output_config: { format: zodOutputFormat(isTechnical ? technicalResearchModelOutputSchema : researchModelOutputSchema) },
          })

          totalInputTokens += message.usage.input_tokens
          totalOutputTokens += message.usage.output_tokens

          const block = message.content.find((b) => b.type === 'text')
          if (!block || block.type !== 'text') throw new Error('No text block in research response')

          const rawJson = JSON.parse(block.text)

          const parsed: ResearchResult = isTechnical
            ? (() => {
                const modelOutput = technicalResearchModelOutputSchema.parse(rawJson)
                const allIdx = [
                  ...modelOutput.primaryRecommendation.supportingSourceIndexes,
                  ...modelOutput.alternative.supportingSourceIndexes,
                  ...modelOutput.notRecommended.flatMap((n) => n.supportingSourceIndexes),
                ]
                if (!allIndexesValid(allIdx, rawSources.length)) throw new Error('supportingSourceIndexes references an index outside the real source list')

                return technicalResearchOutputSchema.parse({
                  mode: 'technical',
                  executiveSummary: modelOutput.executiveSummary,
                  primaryRecommendation: modelOutput.primaryRecommendation,
                  alternative: modelOutput.alternative,
                  keyTradeoffs: modelOutput.keyTradeoffs,
                  implementationNote: modelOutput.implementationNote,
                  notRecommended: modelOutput.notRecommended,
                  assumptionsAndCaveats: modelOutput.assumptionsAndCaveats,
                  sources: reconcileSources(rawSources, modelOutput.sourceAnnotations),
                })
              })()
            : (() => {
                const modelOutput = researchModelOutputSchema.parse(rawJson)
                const indexesValid = modelOutput.recommendations.every((r) => allIndexesValid(r.supportingSourceIndexes, rawSources.length))
                if (!indexesValid) throw new Error('supportingSourceIndexes references an index outside the real source list')

                return researchOutputSchema.parse({
                  mode: 'commercial',
                  executiveSummary: modelOutput.executiveSummary,
                  sourceGeographyNote: modelOutput.sourceGeographyNote,
                  recommendations: modelOutput.recommendations,
                  fastestOfferToLaunch: modelOutput.fastestOfferToLaunch,
                  assumptionsAndCaveats: modelOutput.assumptionsAndCaveats,
                  sources: reconcileSources(rawSources, modelOutput.sourceAnnotations),
                })
              })()

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
