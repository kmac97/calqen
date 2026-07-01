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
- **Max sources:** `CALQEN_MAX_RESEARCH_SOURCES` (default `5`)
- **Input:** `goal`, plus the task's verbatim `rawInput`, `constraints`, and `acceptanceCriteria` — so the user's requested output structure reaches the prompt, not just a paraphrased goal.
- **Structured output:** the model call uses the Anthropic SDK's native structured-output support (`zodOutputFormat(researchOutputSchema)` + `client.messages.parse(...)`), which constrains generation to the JSON schema derived from `researchOutputSchema` and throws on a response that doesn't validate. No regex extraction or free-text `JSON.parse` is used. An explicit `researchOutputSchema.parse(message.parsed_output)` is kept afterwards as a defense-in-depth validation layer in `research.ts` itself. On validation failure or truncated JSON, the call is retried up to `CALQEN_MAX_AGENT_RETRIES` times (default `2`) before the task fails.
- **Output:**
```typescript
{
  executiveSummary: string
  recommendations: Array<{
    name: string
    problemSolved: string
    workflow: string
    requiredTools: string[]
    // Offer-specific — null for non-commercial/technical research
    targetCustomer: string | null
    setupPriceRangeGbp: string | null
    monthlyRetainerRangeGbp: string | null
    expectedValueOrRoi: string | null
    pricingBasis: 'observed_market_range' | 'estimated_recommendation' | 'not_applicable'
    easeToSellScore: number | null      // 1-10
    profitPotentialScore: number | null // 1-10
    fitForKaineScore: number | null     // 1-10
    supportingSourceIndexes: number[]   // 0-based indices into sources[]; required non-empty when pricingBasis is 'observed_market_range'
  }>
  fastestOfferToLaunch: string
  assumptionsAndCaveats: string[]
  sources: Array<{
    url: string
    title: string
    relevantExcerpt: string
  }>
}
```
- `supportingSourceIndexes` references sources by array index rather than repeating the URL string, because the fast model reliably corrupted long URLs (stray digits, mangled scheme) when the same source was cited by more than one recommendation — small integers can't get mangled that way. The prompt numbers each source `[0]`, `[1]`, ... and requires the model's returned `sources[]` to preserve that exact order/indexing.
- `formatResearchMessages(taskTitle, result)` in `packages/orchestrator/src/agents/researchFormat.ts` is a pure function that turns this output into one or more Telegram message strings, each ≤ 4096 characters (Telegram's hard limit), labelled `(Part i/N)` only when more than one message is produced, resolving `supportingSourceIndexes` back to real URLs for display. `researchLoop` queues one outbox row per chunk (`task:{id}:completed:{i}`).

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
