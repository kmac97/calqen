export interface ResearchPromptContext {
  goal: string
  rawInput: string
  constraints: string[]
  acceptanceCriteria: string[]
}

export function buildResearchPrompt(context: ResearchPromptContext, sourcesText: string): string {
  return `You are producing a structured research result for this Calqen task.

User's original request (verbatim): "${context.rawInput}"
Restated goal: "${context.goal}"
Constraints the user specified: ${context.constraints.length ? context.constraints.join('; ') : '(none)'}
Acceptance criteria the user specified: ${context.acceptanceCriteria.length ? context.acceptanceCriteria.join('; ') : '(none)'}

Source material:
${sourcesText}

Rules:
1. Follow the structure implied by the user's original request, constraints, and acceptance criteria exactly — if they asked for ranked offers, pricing, workflows, ROI, tools, and sources, your recommendations must deliver exactly that. Do not produce a generic summary paragraph.
2. Be direct and practical. State conclusions, not hedged generalities.
3. recommendations must be ranked best-first.
4. Only populate targetCustomer, setupPriceRangeGbp, monthlyRetainerRangeGbp, easeToSellScore, profitPotentialScore, fitForKaineScore when the research concerns a sellable offer or service. For purely technical/comparison research, set every one of those fields to null and set roiModel to null — do not guess values to fill them in.
5. Clearly separate fact from estimate: only state a number, price, or projection as fact if it is directly present in the source material above. Anything you estimate, infer, or project must be phrased with an explicit qualifier such as "estimated" or "approx.", and listed in assumptionsAndCaveats explaining the basis for the estimate.
6. Inline citation: every quantified claim in prose (a number, price, percentage, or time saving) must either cite the source index inline in square brackets (e.g. "saves ~5h/week [1]") or be explicitly marked "(estimated)" if it isn't directly backed by a source. Never state a bare unqualified number.
7. evidenceStrength per recommendation reflects how well-backed the recommendation itself is, judged from source count/type/independence — not a vibe check: "high" (multiple independent or official sources agree), "medium" (some direct source support), "low" (thin or indirect support), "estimate_only" (no direct source, reasoning/estimate only). A recommendation cannot be evidenceStrength "estimate_only" and pricingBasis "observed_market_range" at the same time.
8. sourceAnnotations: return exactly one entry per source in the source material above. Each entry's sourceIndex must be that source's [N] number — you do not need to repeat its URL or title, the server already has those. sourceType classifies the source into exactly one of official_vendor, independent_research, government_or_trade_body, marketplace_or_review, consultancy_or_agency, video_or_social, based on what kind of site it is. relevantExcerpt is a direct quote or close paraphrase of that source's provided excerpt, never invented.
9. UK-relevance: if the user's original request is UK-specific, prefer UK-relevant sources where available. sourceGeographyNote must always plainly state what the actual source set covers geographically (e.g. "All sources are UK trade/industry sites" or "Sources are predominantly US-based; no UK-specific evidence was found") — never let UK relevance be implied when the evidence doesn't support it.
10. pricingBasis per recommendation: use "observed_market_range" ONLY when the price/retainer figures are directly backed by the source material, and in that case supportingSourceIndexes must include at least one index from the source material. Use "estimated_recommendation" when the figures are your own estimate (also note the estimate and its basis in assumptionsAndCaveats). Use "not_applicable" for non-commercial/technical research.
11. roiModel: when a recommendation is a sellable offer, express expected value as extraLeadsOrBookingsPerMonth × conversionRatePercent × avgValuePerConvertedJobGbp − monthlyCostGbp, divided by monthlyCostGbp. Set roiType to "profit_roi" only when avgValuePerConvertedJobGbp is gross profit per job (not raw revenue); set it to "revenue_uplift" and use revenue per job instead if you cannot estimate margin — never present a revenue-only calculation as profit_roi. Leave any of the four numeric fields null if you cannot support them even as an estimate, and always fill calculationNote explaining what's sourced vs. estimated vs. omitted. Set roiModel to null entirely for non-commercial/technical research.
12. supportingSourceIndexes is an array of integers — each entry is the [N] index number of a source in the source material above (e.g. [0], [1]). Reference sources by their index number only; never write out the URL itself in this field, and never invent an index that isn't listed above.
13. Do not name a specific company, course, programme, tool, or service unless it appears in the source material provided above with a URL.
14. Before finalizing, check your recommendations for material overlap — if one recommendation is largely a component of another (e.g. lead capture and appointment booking within one workflow), merge them into a single recommendation rather than listing both, or if you keep them separate, make the distinction explicit in problemSolved/workflow.
15. fastestOfferToLaunch: name the single fastest-to-launch recommendation and a one-line reason. If this research is not about sellable offers, write a short sentence stating that launch-speed ranking does not apply to this query.`
}

export function buildTechnicalResearchPrompt(context: ResearchPromptContext, sourcesText: string): string {
  return `You are producing a structured technical comparison for this Calqen task — this is a technical/engineering decision (library, framework, API, or tool choice), not a commercial offer evaluation.

User's original request (verbatim): "${context.rawInput}"
Restated goal: "${context.goal}"
Constraints the user specified: ${context.constraints.length ? context.constraints.join('; ') : '(none)'}
Acceptance criteria the user specified: ${context.acceptanceCriteria.length ? context.acceptanceCriteria.join('; ') : '(none)'}

Source material:
${sourcesText}

Rules:
1. Scope precisely to the user's stated product, use case, scale, stack, and decision criteria — read them exactly as given, verbatim, in the request above. Do not generalize to a more common or more familiar cousin of the same product category. For example, if the user describes a trading-journal analytics tool, analyse it as exactly that — never assume it is a live-market trading terminal just because both involve "trading" and "charts".
2. Do not include any geographic, regional, or local-market evidence disclaimer — that is not relevant to a technical comparison. Do not mention UK/US/global source coverage at all.
3. Source authority for factual technical claims: official documentation, the official GitHub repository/releases, and official licensing pages outrank package-registry metadata (npm, PyPI, etc.), which outranks blogs, Reddit, videos, and third-party comparison posts — those are optional secondary context only, never the sole basis for a factual claim when an official source exists in the material provided.
4. Every factual technical claim (a rendering approach, a performance characteristic, a license, a capability) must cite a source index in supportingSourceIndexes, preferring the official source when both an official and a secondary source are available. Never invent or assume a rendering technology, license, capability, or performance claim that is not directly stated in the source material — if you don't know, say so explicitly in assumptionsAndCaveats rather than guessing.
5. Produce exactly one primaryRecommendation (the single best fit for the user's stated criteria) and exactly one alternative. Every other option you considered but rejected goes in notRecommended with a one-line reason each — do not omit strong contenders just to keep the list short.
6. keyTradeoffs: the decisive differences between primaryRecommendation and alternative that justify picking one over the other, not a generic feature list.
7. implementationNote: state concretely how primaryRecommendation fits the user's stated stack and scale — this is the "so what do I actually do" answer, not a restatement of its capabilities.
8. licensingNote per option: state the actual license (e.g. "MIT", "Apache-2.0", "commercial/paid") if it appears in the source material; only use null when licensing is genuinely not applicable (e.g. a language built-in feature, not a distributed package) — never guess a license.
9. evidenceStrength per option reflects official-source backing specifically: "high" (official docs/repo/registry directly confirm the claims), "medium" (partial official support, or strong independent confirmation), "low" (inferred from blogs/community discussion only), "estimate_only" (no source, reasoning only).
10. sourceAnnotations: return exactly one entry per source in the source material above. Each entry's sourceIndex must be that source's [N] number — you do not need to repeat its URL or title, the server already has those. sourceType classifies the source into exactly one of official_vendor, independent_research, government_or_trade_body, marketplace_or_review, consultancy_or_agency, video_or_social, based on what kind of site it is (official docs/GitHub/registry pages are official_vendor). relevantExcerpt is a direct quote or close paraphrase of that source's provided excerpt, never invented.
11. supportingSourceIndexes is an array of integers — each entry is the [N] index number of a source in the source material above. Reference sources by their index number only; never write out the URL itself, and never invent an index that isn't listed above.
12. Do not name a specific library, tool, or service unless it appears in the source material provided above.`
}
