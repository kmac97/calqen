import { computeScopeHash, planHashPayload, type TaskPlan } from '@calqen/shared'
import { runAgent, type AgentResult } from './runAgent.js'

export interface ArchitectOutput extends TaskPlan {
  scopeHash: string
  version: number
}

export async function architectTask(taskId: string, goal: string): Promise<ArchitectOutput> {
  console.log(`[ARCHITECT MOCK] planning task ${taskId}`)

  const plan = await runAgent({
    taskId,
    agentType: 'architect',
    provider: 'mock',
    isMock: true,
    fn: async (): Promise<AgentResult<TaskPlan>> => {
      const output: TaskPlan = {
        filesAffected: ['src/feature.ts', 'src/feature.test.ts'],
        proposedChanges: [
          { file: 'src/feature.ts', description: goal.slice(0, 120), changeType: 'modify' },
          { file: 'src/feature.test.ts', description: 'Add tests', changeType: 'modify' },
        ],
        containsDeletions: false,
        risks: ['May affect existing functionality'],
        testPlan: 'Run existing test suite',
        estimatedTokens: 2000,
      }
      return { output, prompt: '[ARCHITECT MOCK]' }
    },
  })

  const version = 1
  const scopeHash = computeScopeHash(planHashPayload({ ...plan, version }))
  return { ...plan, version, scopeHash }
}
