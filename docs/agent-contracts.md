# Agent Contracts

All agents are invoked through the `runAgent` wrapper which handles logging, spend checks, and redaction.

## CalqenOrchestrator (REAL)

### classifyTask
- **Model:** `CALQEN_FAST_MODEL`
- **Input:** raw user message, list of known projects
- **Structured output:** same approach as `research.ts` — `client.messages.create(...)` with `output_config: { format: zodOutputFormat(classificationOutputSchema) }`, then `classificationOutputSchema.parse(JSON.parse(...))` as an explicit defense-in-depth validation step. No regex extraction, no "respond with JSON only" reliance. The prompt is a pure, testable `buildClassifyPrompt()` in `packages/orchestrator/src/agents/classifyPrompt.ts`.
- **Single attempt, no retry:** unlike `research.ts`, classification does not retry on failure — classification calls have been reliable and cheap in practice. On any failure (API error, parse failure, Zod rejection), `classifyTask` throws `PartialUsageError` (capturing whatever usage was returned before the failure, so the one real attempt is still billed), and `classifyLoop` (`packages/orchestrator/src/loop.ts`) routes the task straight to `needs_human_review` — a distinct, already-existing terminal status (previously only used by the Runner's deletion-review flow) — rather than the generic `failed` status or any guessed/default classification. This is what makes "never silently misclassify" true by construction: a broken classification call can never produce a task that looks classified.
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
  isTechnicalComparison: boolean   // selects technical vs commercial research mode — see ResearchAgent below
}
```
- Research tasks with `projectRequired: false` get `project_id = null`
- `isTechnicalComparison` can't be persisted as a new `tasks.taskType` enum value without a migration, so `classifyLoop` threads it through via `TECHNICAL_COMPARISON_MARKER` in the existing `constraints[]` column instead (see "Technical comparison mode" under ResearchAgent below) — only on the final "classified" transition, not on an intermediate `awaiting_clarification` round.

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
- **Structured output:** the model call uses `client.messages.create(...)` with `output_config: { format: zodOutputFormat(researchModelOutputSchema) }` (from the Anthropic SDK's structured-output support) — a distinct, model-facing schema (see Source canonicalisation below), not the final `researchOutputSchema`. The response text is parsed with `researchModelOutputSchema.parse(JSON.parse(...))` — one explicit validation step in `research.ts` itself, no regex extraction. (`messages.create`, not the `.parse()` convenience wrapper, is used specifically so `message.usage` is available even on a validation failure — see spend accounting below.)
- **Source canonicalisation:** the model never returns `url`/`title`/a `sources` array at all — the Firecrawl search results (`rawSources`) are the *sole* canonical source list. The model returns `sourceAnnotations: Array<{ sourceIndex, sourceType, relevantExcerpt }>` keyed by index, and `reconcileSources()` (`packages/orchestrator/src/agents/researchSources.ts`) builds the final `sources[]` directly from `rawSources`, attaching each annotation by matching `sourceIndex` — never by array position. This means the model's source count, order, or any URL-transcription mistake can no longer corrupt the final source list: a raw source with no matching annotation (fewer annotations than sources) still appears, honestly marked `sourceType: 'unclassified'`; an out-of-range or negative `sourceIndex` is dropped entirely rather than misattached. `supportingSourceIndexes` on each recommendation is validated against the real `rawSources.length` (ground truth), not whatever count the model claims.
- **Retry, cancellation, and spend:** on validation failure or truncated JSON, the call is retried up to `CALQEN_MAX_AGENT_RETRIES` times (default `2`, non-numeric env values fall back to the default rather than silently disabling retries) with a short linear backoff between attempts. `cancel_requested_at` is re-checked before every attempt, not just once before the whole call, so a `/cancel` mid-retry stops further billed calls. Token usage from every attempt — including failed ones — is summed and billed to `tasks.spent_usd`; if all attempts fail, the accumulated usage is still recorded via `PartialUsageError` (`packages/orchestrator/src/agents/runAgent.ts`) rather than silently dropped.
- **Output:**
```typescript
{
  executiveSummary: string
  // Always populated — states what the source set actually covers geographically, so
  // UK/regional relevance is never silently implied when the evidence is really US/global.
  sourceGeographyNote: string
  recommendations: Array<{
    name: string
    problemSolved: string
    workflow: string
    requiredTools: string[]
    // How well-backed the recommendation itself is (source count/type/independence), not pricing-specific
    evidenceStrength: 'high' | 'medium' | 'low' | 'estimate_only'
    // Offer-specific — null for non-commercial/technical research
    targetCustomer: string | null
    setupPriceRangeGbp: string | null
    monthlyRetainerRangeGbp: string | null
    roiModel: {
      roiType: 'profit_roi' | 'revenue_uplift'
      // Individually nullable — partial data doesn't force fabrication. The formatter only
      // computes a numeric ROI% when all four are present; otherwise shows calculationNote alone.
      extraLeadsOrBookingsPerMonth: number | null
      conversionRatePercent: number | null       // 0-100
      avgValuePerConvertedJobGbp: number | null   // gross profit/job if profit_roi, revenue/job if revenue_uplift
      monthlyCostGbp: number | null
      calculationNote: string
    } | null
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
    sourceType: 'official_vendor' | 'independent_research' | 'government_or_trade_body' | 'marketplace_or_review' | 'consultancy_or_agency' | 'video_or_social' | 'unclassified'
  }>
}
```
- A recommendation cannot have `evidenceStrength: 'estimate_only'` and `pricingBasis: 'observed_market_range'` at the same time (schema refine) — an estimate-only recommendation can't simultaneously claim sourced-market pricing.
- `roiModel`'s ROI% is **computed by the formatter, not the model** — `packages/orchestrator/src/agents/researchFormat.ts` calculates `(extraLeadsOrBookingsPerMonth × conversionRatePercent/100 × avgValuePerConvertedJobGbp − monthlyCostGbp) / monthlyCostGbp` itself from the four numbers and labels it by `roiType`, so profit-vs-revenue framing and the formula can't be skipped or fudged by the model. Falls back to `calculationNote` alone when any number is null or `monthlyCostGbp` is `0`.
- `supportingSourceIndexes` references sources by array index rather than repeating the URL string, because the fast model reliably corrupted long URLs (stray digits, mangled scheme) when the same source was cited by more than one recommendation — small integers can't get mangled that way. The prompt numbers each source `[0]`, `[1]`, ... and the model references those numbers; it no longer needs to reproduce a `sources[]` array at all (see Source canonicalisation above), which closes this off structurally rather than just defensively.
- The prompt (extracted to a pure, testable `buildResearchPrompt()` in `packages/orchestrator/src/agents/researchPrompt.ts`) also requires: inline `[N]` citation or an explicit "(estimated)" marker for every quantified claim in prose; one `sourceAnnotations` entry per source classifying it into exactly one `sourceType`; and checking recommendations for material overlap before finalizing, merging them or explicitly distinguishing them rather than listing near-duplicates.
- `formatResearchMessages(taskTitle, result)` in `packages/orchestrator/src/agents/researchFormat.ts` is a pure function that turns this output into one or more Telegram message strings, each ≤ 4096 characters (Telegram's hard limit), labelled `(Part i/N)` only when more than one message is produced, resolving `supportingSourceIndexes` back to real URLs for display. `researchLoop` queues one outbox row per chunk (`task:{id}:completed:{i}`).

### Technical comparison mode

Everything above is `mode: 'commercial'` — the `ResearchOutput` shape. Technical-comparison requests (library/framework/API/tool decisions) instead produce a structurally distinct `mode: 'technical'` shape (`TechnicalResearchOutput`), never the commercial one with fields nulled out:

```typescript
{
  mode: 'technical'
  executiveSummary: string
  primaryRecommendation: TechnicalOption   // exactly one
  alternative: TechnicalOption             // exactly one
  keyTradeoffs: string[]
  implementationNote: string                // how primaryRecommendation fits the user's stated stack
  notRecommended: Array<{ name: string; reason: string; supportingSourceIndexes: number[] }>
  assumptionsAndCaveats: string[]
  sources: Array<{ url: string; title: string; relevantExcerpt: string; sourceType: ... }>
}

// TechnicalOption:
{
  name: string
  whyThisFits: string
  keyCapabilities: string[]
  licensingNote: string | null   // the actual stated license; null only when genuinely not applicable
  evidenceStrength: 'high' | 'medium' | 'low' | 'estimate_only'
  supportingSourceIndexes: number[]
}
```

No `pricingBasis`, `roiModel`, `targetCustomer`, `setupPriceRangeGbp`, `monthlyRetainerRangeGbp`, `fastestOfferToLaunch`, or `sourceGeographyNote` field exists anywhere in this shape — commercial framing is structurally impossible to inject into a technical comparison, not just left null by convention.

- **Detection:** `classifyTask` (`packages/orchestrator/src/agents/classify.ts`) sets `isTechnicalComparison: boolean` on its classification output. Since `tasks.taskType` is a real Postgres enum (adding a value needs a migration), `classifyLoop` (`packages/orchestrator/src/loop.ts`) instead appends a shared `TECHNICAL_COMPARISON_MARKER` constant (`packages/shared/src/outbox.ts`, same pattern as `CLARIFICATION_MARKER`) to the persisted `constraints[]` array when true. `research.ts` reads the marker, strips it before building the prompt, and branches on it to select `buildTechnicalResearchPrompt()`/`technicalResearchModelOutputSchema` instead of the commercial equivalents — the model never sees the marker.
- **Source authority:** the technical prompt (`buildTechnicalResearchPrompt` in `researchPrompt.ts`) instructs official documentation/GitHub/licensing pages to outrank blogs/Reddit/videos for factual claims, and requires an explicit source citation for any rendering/performance/licensing/capability claim. The Firecrawl search query itself is also biased toward `"... official documentation GitHub license"` for technical requests. In practice a single search query can't guarantee surfacing each candidate's own official docs page (which library will even be a candidate isn't known until after research reasoning) — when official sources aren't available, the model is required to say so honestly in `assumptionsAndCaveats` rather than cite a blog as if it were authoritative. A fuller fix would need a second, candidate-specific search pass — out of scope for this change.
- **Grounding:** the prompt prohibits inventing a rendering technology, license, capability, or performance claim not directly stated in the source material, and prohibits generalizing the user's stated product/use case to a more common cousin of the same category (e.g. treating a trading-journal analytics tool as a live-market trading terminal just because both involve charts).
- `formatResearchMessages` renders technical mode distinctly and more compactly than commercial mode: primary/alternative blocks (name, evidence, fit, capabilities, licensing, sources), key trade-offs, an implementation note, and a not-recommended list — reusing the same `renderSource`/`sourceTypeLabel`/`evidenceStrengthLabel` helpers as commercial mode.

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
