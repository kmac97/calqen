import { eq } from 'drizzle-orm'
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import FirecrawlApp from '@mendable/firecrawl-js'
import { db, tasks, researchOutputSchema, type ResearchOutput } from '@calqen/shared'
import { runAgent, CancelledError, PartialUsageError, type AgentResult } from './runAgent.js'
import { buildResearchPrompt } from './researchPrompt.js'
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

      const prompt = buildResearchPrompt(context, sourcesText)

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
