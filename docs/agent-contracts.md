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
- **Structured output:** the model call uses `client.messages.create(...)` with `output_config: { format: zodOutputFormat(researchOutputSchema) }` (from the Anthropic SDK's structured-output support), which constrains generation to the JSON schema derived from `researchOutputSchema`. The response text is then parsed with `researchOutputSchema.parse(JSON.parse(...))` — one explicit validation step in `research.ts` itself, no regex extraction. (`messages.create`, not the `.parse()` convenience wrapper, is used specifically so `message.usage` is available even on a validation failure — see spend accounting below.)
- **Source reconciliation:** after validation, each `sources[i].url`/`title` is overwritten from the original Firecrawl search result at the same index, rather than trusting the model's copy — the model only needs to get a source's *index* right (via `supportingSourceIndexes`), never retype a URL.
- **Retry, cancellation, and spend:** on validation failure or truncated JSON, the call is retried up to `CALQEN_MAX_AGENT_RETRIES` times (default `2`, non-numeric env values fall back to the default rather than silently disabling retries) with a short linear backoff between attempts. `cancel_requested_at` is re-checked before every attempt, not just once before the whole call, so a `/cancel` mid-retry stops further billed calls. Token usage from every attempt — including failed ones — is summed and billed to `tasks.spent_usd`; if all attempts fail, the accumulated usage is still recorded via `PartialUsageError` (`packages/orchestrator/src/agents/runAgent.ts`) rather than silently dropped.
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
