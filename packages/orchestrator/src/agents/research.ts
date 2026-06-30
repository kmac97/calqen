import Anthropic from '@anthropic-ai/sdk'
import FirecrawlApp from '@mendable/firecrawl-js'
import { researchOutputSchema, type ResearchOutput } from '@calqen/shared'
import { runAgent, type AgentResult } from './runAgent.js'

const client = new Anthropic()
const FAST_MODEL = process.env['CALQEN_FAST_MODEL'] ?? 'claude-haiku-4-5-20251001'
const MAX_SOURCES = parseInt(process.env['CALQEN_MAX_RESEARCH_SOURCES'] ?? '3', 10)

export async function researchTask(taskId: string, goal: string): Promise<ResearchOutput> {
  return runAgent({
    taskId,
    agentType: 'researcher',
    provider: 'firecrawl',
    isMock: false,
    fn: async (): Promise<AgentResult<ResearchOutput>> => {
      const firecrawl = new FirecrawlApp({ apiKey: process.env['FIRECRAWL_API_KEY']! })
      const searchResult = await firecrawl.search(goal, { limit: MAX_SOURCES })
      const rawSources = (searchResult.web ?? []).slice(0, MAX_SOURCES) as Array<{
        url?: string; title?: string; description?: string
      }>

      const sourcesText = rawSources
        .map((s) => `URL: ${s.url ?? ''}\nTitle: ${s.title ?? ''}\nExcerpt: ${s.description ?? ''}`.trim())
        .join('\n\n---\n\n')

      const prompt = `Summarize the following research results for this goal: "${goal}"

${sourcesText}

Respond with JSON only:
{
  "summary": "concise summary of findings",
  "sources": [{"url": "...", "title": "...", "relevantExcerpt": "..."}]
}`

      const msg = await client.messages.create({
        model: FAST_MODEL,
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
      })

      const block = msg.content.find((b) => b.type === 'text')
      if (!block || block.type !== 'text') throw new Error('No text block in research response')

      const match = block.text.match(/\{[\s\S]*\}/)
      if (!match) throw new Error('No JSON in research response')

      const parsed = researchOutputSchema.parse(JSON.parse(match[0]))

      return { output: parsed, prompt, inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens, modelUsed: FAST_MODEL }
    },
  })
}
