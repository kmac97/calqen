import { createHash } from 'crypto'

function sortKeysDeep(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(sortKeysDeep)
  if (obj !== null && typeof obj === 'object') {
    return Object.fromEntries(
      Object.keys(obj as Record<string, unknown>)
        .sort()
        .map((k) => [k, sortKeysDeep((obj as Record<string, unknown>)[k])]),
    )
  }
  return obj
}

// Canonical fields used for scope_hash — must match between orchestrator (create) and API (verify)
export function planHashPayload(plan: {
  filesAffected: string[]
  proposedChanges: unknown
  containsDeletions: boolean
  risks: string[]
  testPlan: string
  version: number
}) {
  return {
    containsDeletions: plan.containsDeletions,
    filesAffected: plan.filesAffected,
    proposedChanges: plan.proposedChanges,
    risks: plan.risks,
    testPlan: plan.testPlan,
    version: plan.version,
  }
}

export function computeScopeHash(plan: unknown): string {
  const canonical = JSON.stringify(sortKeysDeep(plan))
  return createHash('sha256').update(canonical).digest('hex')
}
