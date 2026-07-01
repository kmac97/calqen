import type { ResearchSource, SourceAnnotation } from '@calqen/shared'

export interface RawSource {
  url?: string
  title?: string
  description?: string
}

// Builds the final, canonical sources[] directly from the real Firecrawl results — the model's
// annotations (sourceType/relevantExcerpt) are attached by matching sourceIndex, never trusted for
// url/title/count/order. Out-of-range indexes are dropped; raw sources with no matching annotation
// (the model returned fewer annotations than sources) still appear, honestly marked 'unclassified'
// rather than guessing a real category.
export function reconcileSources(rawSources: RawSource[], annotations: SourceAnnotation[]): ResearchSource[] {
  const byIndex = new Map<number, SourceAnnotation>()
  for (const annotation of annotations) {
    if (annotation.sourceIndex >= 0 && annotation.sourceIndex < rawSources.length) {
      byIndex.set(annotation.sourceIndex, annotation)
    }
  }

  return rawSources.map((raw, i) => {
    const annotation = byIndex.get(i)
    return {
      url: raw.url ?? '',
      title: raw.title ?? '',
      sourceType: annotation?.sourceType ?? 'unclassified',
      relevantExcerpt: annotation?.relevantExcerpt ?? raw.description ?? '',
    }
  })
}

// Every supportingSourceIndexes entry across all recommendations must reference a real raw
// source — validated against the ground-truth Firecrawl count, never whatever the model claims.
export function allIndexesValid(indexes: number[], rawSourceCount: number): boolean {
  return indexes.every((i) => i >= 0 && i < rawSourceCount)
}
