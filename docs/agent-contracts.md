# Agent Contracts

All agents are invoked through the `runAgent` wrapper which handles logging, spend checks, and redaction.

## CalqenOrchestrator (REAL)

### classifyTask
- **Model:** `CALQEN_FAST_MODEL`
- **Input:** raw user message, list of known projects
- **Output (Zod-validated):**
```typescript
{
  title: string
  goal: string
  taskType: 'feature' | 'research' | 'debug' | 'review'
  executionTarget: 'orchestrator' | 'runner'
  projectName: string | null
  projectRequired: boolean
  clarificationQuestion: string | null
  constraints: string[]
  acceptanceCriteria: string[]
  riskLevel: 'low' | 'medium' | 'high'
  requiresApproval: boolean
}
```
- Research tasks with `projectRequired: false` get `project_id = null`

### synthesisePlan
- **Model:** `CALQEN_ORCHESTRATOR_MODEL`
- **Input:** task details, architect plan
- **Output:** formatted outbox message content string

---

## ArchitectAgent (MOCKED — Phase 1)

- **Log prefix:** `[ARCHITECT MOCK]`
- **Provider:** `'mock'`
- **is_mock:** `true`
- **Cost/tokens:** null
- **Output:**
```typescript
{
  filesAffected: string[]
  proposedChanges: Array<{ file: string; description: string; changeType: 'create' | 'modify' | 'delete' }>
  containsDeletions: boolean
  risks: string[]
  testPlan: string
  estimatedTokens: number
}
```
- `scope_hash` is computed from real plan data: `computeScopeHash(plan)`

---

## BuilderAgent (MOCKED — Phase 1)

- **Log prefix:** `[BUILDER MOCK]`
- **Provider:** `'mock'`
- **is_mock:** `true`
- **Delay:** 2s simulated work
- **No disk writes, no Git commands**
- **Output:** structured mock diff
```typescript
{
  diff: string          // unified diff format string
  filesChanged: string[]
  filesCreated: string[]
  filesModified: string[]
  filesDeleted: string[]
}
```

---

## VerifierAgent (MOCKED — Phase 1)

- **Log prefix:** `[VERIFIER MOCK]`
- **Provider:** `'mock'`
- **is_mock:** `true`
- **Output:**
```typescript
{
  passed: boolean
  testOutput: string
  summary: string
}
```

---

## ResearchAgent (REAL)

- **Provider:** `'firecrawl'`
- **Summarisation model:** `CALQEN_FAST_MODEL`
- **Max sources:** `CALQEN_MAX_RESEARCH_SOURCES`
- **Output:**
```typescript
{
  summary: string
  sources: Array<{
    url: string
    title: string
    relevantExcerpt: string
  }>
}
```

---

## runAgent Wrapper Contract

```typescript
async function runAgent<T>(params: {
  taskId: string
  agentType: AgentType
  provider: string
  isMock: boolean
  fn: () => Promise<AgentResult<T>>
}): Promise<T>
```

1. Creates `agent_runs` row (status: `pending`)
2. Checks `cancel_requested_at` → throws `CancelledError`
3. Checks `spent_usd >= budget_usd` → throws `BudgetExceededError`
4. Calls `fn()`
5. Applies `redactSecrets()` to prompt and output
6. Updates `agent_runs` with result
7. For real runs: increments `tasks.spent_usd`
8. Inserts audit events for start and completion

Mock runs never increment `spent_usd`. Cost and tokens are null for mocks.
