import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { classificationOutputSchema, type ClassificationOutput, type Project } from '@calqen/shared'
import { runAgent, PartialUsageError, type AgentResult } from './runAgent.js'
import { buildClassifyPrompt } from './classifyPrompt.js'

const client = new Anthropic()
const FAST_MODEL = process.env['CALQEN_FAST_MODEL'] ?? 'claude-haiku-4-5-20251001'
const ORCH_MODEL = process.env['CALQEN_ORCHESTRATOR_MODEL'] ?? 'claude-sonnet-4-6'

export async function classifyTask(
  taskId: string,
  rawInput: string,
  projects: Project[],
): Promise<ClassificationOutput> {
  return runAgent({
    taskId,
    agentType: 'calqen',
    provider: 'anthropic',
    isMock: false,
    fn: async (): Promise<AgentResult<ClassificationOutput>> => {
      const prompt = buildClassifyPrompt(rawInput, projects)

      // Single attempt, no retry loop — classification has been reliable and cheap all session.
      // On any failure, PartialUsageError still bills whatever real attempt was made (usage is
      // captured as soon as the API call returns, before the parse step that might throw), and
      // classifyLoop's catch-all routes the task to needs_human_review rather than silently
      // guessing a shape.
      let inputTokens = 0
      let outputTokens = 0

      try {
        const msg = await client.messages.create({
          model: FAST_MODEL,
          max_tokens: 2048,
          messages: [{ role: 'user', content: prompt }],
          output_config: { format: zodOutputFormat(classificationOutputSchema) },
        })

        inputTokens = msg.usage.input_tokens
        outputTokens = msg.usage.output_tokens

        const block = msg.content.find((b) => b.type === 'text')
        if (!block || block.type !== 'text') throw new Error('No text block in classify response')

        const parsed = classificationOutputSchema.parse(JSON.parse(block.text))

        return { output: parsed, prompt, inputTokens, outputTokens, modelUsed: FAST_MODEL }
      } catch (err) {
        throw new PartialUsageError(err, { inputTokens, outputTokens, modelUsed: FAST_MODEL })
      }
    },
  })
}

export async function synthesisePlan(
  taskId: string,
  task: { title: string; goal: string; riskLevel: string },
  plan: { filesAffected: string[]; proposedChanges: unknown[]; risks: string[]; testPlan: string },
  shortId: string,
): Promise<string> {
  return runAgent({
    taskId,
    agentType: 'calqen',
    provider: 'anthropic',
    isMock: false,
    fn: async (): Promise<AgentResult<string>> => {
      const prompt = `Format this plan as a concise Telegram approval message (plain text, no markdown). Include short-id ${shortId}.

Task: ${task.title}
Goal: ${task.goal}
Risk: ${task.riskLevel}
Files affected: ${plan.filesAffected.join(', ')}
Changes: ${JSON.stringify(plan.proposedChanges)}
Risks: ${plan.risks.join('; ')}
Test plan: ${plan.testPlan}

Output the message text only. Start with "📐 Plan — ${shortId}".`

      const msg = await client.messages.create({
        model: ORCH_MODEL,
        max_tokens: 512,
        messages: [{ role: 'user', content: prompt }],
      })

      const block = msg.content.find((b) => b.type === 'text')
      if (!block || block.type !== 'text') throw new Error('No text block in synthesise response')

      return { output: block.text.trim(), prompt, inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens, modelUsed: ORCH_MODEL }
    },
  })
}
