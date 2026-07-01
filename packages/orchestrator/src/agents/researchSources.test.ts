import { describe, it, expect } from 'vitest'
import type { SourceAnnotation } from '@calqen/shared'
import { reconcileSources, allIndexesValid, type RawSource } from './researchSources.js'

const rawSources: RawSource[] = [
  { url: 'https://a.example.com', title: 'Source A', description: 'Excerpt A from Firecrawl' },
  { url: 'https://b.example.com', title: 'Source B', description: 'Excerpt B from Firecrawl' },
  { url: 'https://c.example.com', title: 'Source C', description: 'Excerpt C from Firecrawl' },
]

function annotation(overrides: Partial<SourceAnnotation> = {}): SourceAnnotation {
  return { sourceIndex: 0, sourceType: 'independent_research', relevantExcerpt: 'model excerpt', ...overrides }
}

describe('reconcileSources', () => {
  it('always sources url/title from rawSources, never from the model, for a fully-annotated set', () => {
    const annotations = rawSources.map((_, i) => annotation({ sourceIndex: i, relevantExcerpt: `model excerpt ${i}` }))
    const sources = reconcileSources(rawSources, annotations)
    expect(sources).toHaveLength(3)
    sources.forEach((s, i) => {
      expect(s.url).toBe(rawSources[i]!.url)
      expect(s.title).toBe(rawSources[i]!.title)
      expect(s.relevantExcerpt).toBe(`model excerpt ${i}`)
    })
  })

  it('handles the model returning fewer annotations than raw sources — every raw source still appears', () => {
    // Only annotate index 0; indexes 1 and 2 get no annotation at all.
    const sources = reconcileSources(rawSources, [annotation({ sourceIndex: 0, relevantExcerpt: 'only this one annotated' })])
    expect(sources).toHaveLength(3)
    expect(sources[0]!.relevantExcerpt).toBe('only this one annotated')
    expect(sources[0]!.sourceType).toBe('independent_research')
    // Un-annotated sources fall back honestly instead of guessing a real category.
    expect(sources[1]!.sourceType).toBe('unclassified')
    expect(sources[1]!.url).toBe(rawSources[1]!.url)
    expect(sources[1]!.relevantExcerpt).toBe(rawSources[1]!.description)
    expect(sources[2]!.sourceType).toBe('unclassified')
    expect(sources[2]!.url).toBe(rawSources[2]!.url)
  })

  it('handles the model returning annotations out of order — attaches by sourceIndex, not array position', () => {
    const outOfOrder = [
      annotation({ sourceIndex: 2, relevantExcerpt: 'about C', sourceType: 'government_or_trade_body' }),
      annotation({ sourceIndex: 0, relevantExcerpt: 'about A', sourceType: 'official_vendor' }),
      annotation({ sourceIndex: 1, relevantExcerpt: 'about B', sourceType: 'marketplace_or_review' }),
    ]
    const sources = reconcileSources(rawSources, outOfOrder)
    // Despite the annotation array being in 2,0,1 order, each ends up attached to the correct raw source.
    expect(sources[0]).toMatchObject({ url: rawSources[0]!.url, relevantExcerpt: 'about A', sourceType: 'official_vendor' })
    expect(sources[1]).toMatchObject({ url: rawSources[1]!.url, relevantExcerpt: 'about B', sourceType: 'marketplace_or_review' })
    expect(sources[2]).toMatchObject({ url: rawSources[2]!.url, relevantExcerpt: 'about C', sourceType: 'government_or_trade_body' })
  })

  it('drops an annotation with an out-of-range sourceIndex rather than misattaching it', () => {
    const annotations = [
      annotation({ sourceIndex: 0, relevantExcerpt: 'about A' }),
      annotation({ sourceIndex: 99, relevantExcerpt: 'this index does not exist' }),
    ]
    const sources = reconcileSources(rawSources, annotations)
    expect(sources).toHaveLength(3)
    expect(sources[0]!.relevantExcerpt).toBe('about A')
    // The out-of-range annotation must not leak onto any real source.
    for (const s of sources) expect(s.relevantExcerpt).not.toBe('this index does not exist')
  })

  it('never pairs an excerpt/sourceType with the wrong canonical URL/title, even under combined chaos (missing + out-of-order + invalid indexes)', () => {
    const chaos = [
      annotation({ sourceIndex: 2, relevantExcerpt: 'C excerpt', sourceType: 'video_or_social' }),
      annotation({ sourceIndex: -1, relevantExcerpt: 'negative index, must be dropped' }),
      annotation({ sourceIndex: 50, relevantExcerpt: 'way out of range, must be dropped' }),
      // index 0 and 1 both get no annotation
    ]
    const sources = reconcileSources(rawSources, chaos)
    expect(sources).toHaveLength(3)

    // Index 2 got a real annotation — must be attached to C's real url/title, not shifted.
    expect(sources[2]).toMatchObject({ url: 'https://c.example.com', title: 'Source C', relevantExcerpt: 'C excerpt', sourceType: 'video_or_social' })
    // Indexes 0 and 1 have no annotation — honest fallback, still correct url/title.
    expect(sources[0]).toMatchObject({ url: 'https://a.example.com', title: 'Source A', sourceType: 'unclassified' })
    expect(sources[1]).toMatchObject({ url: 'https://b.example.com', title: 'Source B', sourceType: 'unclassified' })
    // The invalid-index annotations must not appear anywhere in the output.
    for (const s of sources) {
      expect(s.relevantExcerpt).not.toContain('must be dropped')
    }
  })

  it('falls back to an empty string url/title when Firecrawl itself omitted them, never undefined/crash', () => {
    const sparse: RawSource[] = [{}]
    const sources = reconcileSources(sparse, [])
    expect(sources).toEqual([{ url: '', title: '', sourceType: 'unclassified', relevantExcerpt: '' }])
  })
})

describe('allIndexesValid', () => {
  it('accepts indexes within range', () => {
    expect(allIndexesValid([0, 1, 2], 3)).toBe(true)
  })

  it('rejects an index equal to the count (out of range, zero-based)', () => {
    expect(allIndexesValid([3], 3)).toBe(false)
  })

  it('rejects a negative index', () => {
    expect(allIndexesValid([-1], 3)).toBe(false)
  })

  it('accepts an empty array regardless of count', () => {
    expect(allIndexesValid([], 0)).toBe(true)
  })
})
