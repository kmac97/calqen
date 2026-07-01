import type { Project } from '@calqen/shared'

export function buildClassifyPrompt(rawInput: string, projects: Project[]): string {
  const projectList = projects.map((p) => `- ${p.name} (${p.githubRepo})`).join('\n') || '(none)'

  return `You are Calqen, an AI orchestration system. Classify the user request below.

Available projects:
${projectList}

User request: ${rawInput}

Determine:
- title: short title max 80 chars
- goal: what the user wants
- taskType: "feature" | "research" | "debug" | "review"
- executionTarget: "runner" (code changes) | "orchestrator" (research/review)
- projectName: exact project name or null
- projectRequired: true | false
- clarificationQuestion: question string if the request is ambiguous, else null
- constraints: array of constraints the user specified (include any geographic/regional scope, e.g. "UK-relevant sources only", as its own entry when the user states or implies one)
- acceptanceCriteria: array of acceptance criteria
- riskLevel: "low" | "medium" | "high"
- requiresApproval: true | false
- isTechnicalComparison: true | false

isTechnicalComparison is true only when the request is fundamentally about comparing or choosing between software libraries, frameworks, APIs, or technical tools for a stack/implementation decision (e.g. "which charting library should I use for Thesis"). It is false for commercial offer/business-idea research (e.g. "AI services I could sell to Leeds roofing firms"), current-events or regulatory research, and any non-technical-comparison request — including when taskType is not "research" at all.`
}
