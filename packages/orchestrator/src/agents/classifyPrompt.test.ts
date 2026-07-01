import { describe, it, expect } from 'vitest'
import type { Project } from '@calqen/shared'
import { buildClassifyPrompt } from './classifyPrompt.js'

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Thesis',
    githubRepo: 'kmac97/thesis',
    githubDefaultBranch: 'main',
    localPath: null,
    stack: null,
    settings: {},
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('buildClassifyPrompt', () => {
  it('includes the verbatim rawInput and lists available projects', () => {
    const prompt = buildClassifyPrompt('Compare the best charting libraries for Thesis.', [project()])
    expect(prompt).toContain('Compare the best charting libraries for Thesis.')
    expect(prompt).toContain('Thesis (kmac97/thesis)')
  })

  it('handles an empty project list without crashing', () => {
    const prompt = buildClassifyPrompt('Find three AI services I could sell to Leeds roofing firms.', [])
    expect(prompt).toContain('(none)')
  })

  it('lists all four taskType options', () => {
    const prompt = buildClassifyPrompt('anything', [])
    for (const type of ['feature', 'research', 'debug', 'review']) expect(prompt).toContain(type)
  })

  it('instructs isTechnicalComparison with a technical-comparison example (Thesis-style) and a commercial counter-example (Leeds-style)', () => {
    const prompt = buildClassifyPrompt('anything', [])
    expect(prompt).toContain('isTechnicalComparison')
    expect(prompt).toMatch(/charting library/i)
    expect(prompt).toMatch(/Leeds roofing/i)
  })

  it('requires clarificationQuestion to be null when unambiguous, not omitted', () => {
    const prompt = buildClassifyPrompt('anything', [])
    expect(prompt).toContain('clarificationQuestion')
    expect(prompt).toMatch(/ambiguous/i)
  })

  it('instructs constraints to capture geographic/regional scope when the user states or implies one', () => {
    const prompt = buildClassifyPrompt('anything', [])
    expect(prompt).toMatch(/geographic|regional/i)
  })
})
