import Anthropic from '@anthropic-ai/sdk'
import { classificationOutputSchema, type ClassificationOutput, type Project } from '@calqen/shared'
import { runAgent, type AgentResult } from './runAgent.js'

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
      const projectList = projects.map((p) => `- ${p.name} (${p.githubRepo})`).join('\n') || '(none)'
      const prompt = `You are Calqen, an AI orchestration system. Classify the user request below.

Available projects:
${projectList}

User request: ${rawInput}

Respond with valid JSON only:
{
  "title": "short title max 80 chars",
  "goal": "what the user wants",
  "taskType": "feature" | "research" | "debug" | "review",
  "executionTarget": "runner" (code changes) | "orchestrator" (research/review),
  "projectName": "exact project name or null",
  "projectRequired": true | false,
  "clarificationQuestion": "question string if ambiguous else null",
  "constraints": ["..."],
  "acceptanceCriteria": ["..."],
  "riskLevel": "low" | "medium" | "high",
  "requiresApproval": true | false,
  "isTechnicalComparison": true | false
}

isTechnicalComparison is true only when the request is fundamentally about comparing or choosing between software libraries, frameworks, APIs, or technical tools for a stack/implementation decision (e.g. "which charting library should I use"). It is false for commercial offer/business-idea research, current-events or regulatory research, and any non-technical-comparison request — including when taskType is not "research" at all.`

      const msg = await client.messages.create({
        model: FAST_MODEL,
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      })

      const block = msg.content.find((b) => b.type === 'text')
      if (!block || block.type !== 'text') throw new Error('No text block in classify response')

      const match = block.text.match(/\{[\s\S]*\}/)
      if (!match) throw new Error('No JSON in classify response')

      const parsed = classificationOutputSchema.parse(JSON.parse(match[0]))

      return { output: parsed, prompt, inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens, modelUsed: FAST_MODEL }
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
