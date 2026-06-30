import { describe, it, expect } from 'vitest'
import { checkDiffPolicy, isProtectedBranch } from './policy.js'

describe('isProtectedBranch', () => {
  it('blocks protected branches', () => {
    expect(isProtectedBranch('main')).toBe(true)
    expect(isProtectedBranch('master')).toBe(true)
    expect(isProtectedBranch('develop')).toBe(true)
    expect(isProtectedBranch('production')).toBe(true)
    expect(isProtectedBranch('prod')).toBe(true)
  })

  it('allows calqen branches', () => {
    expect(isProtectedBranch('calqen/abc12345')).toBe(false)
    expect(isProtectedBranch('feature/foo')).toBe(false)
    expect(isProtectedBranch('dev')).toBe(false)
  })
})

describe('checkDiffPolicy', () => {
  it('clean: all changed files are in the plan', () => {
    const result = checkDiffPolicy(
      { filesDeleted: [], filesChanged: ['src/a.ts', 'src/b.ts'] },
      ['src/a.ts', 'src/b.ts'],
    )
    expect(result.clean).toBe(true)
    expect(result.deletedFiles).toHaveLength(0)
    expect(result.unplannedPaths).toHaveLength(0)
  })

  it('detects deleted files', () => {
    const result = checkDiffPolicy(
      { filesDeleted: ['src/old.ts'], filesChanged: ['src/old.ts'] },
      ['src/old.ts'],
    )
    expect(result.clean).toBe(false)
    expect(result.deletedFiles).toEqual(['src/old.ts'])
  })

  it('detects unplanned paths', () => {
    const result = checkDiffPolicy(
      { filesDeleted: [], filesChanged: ['src/a.ts', 'src/secret.ts'] },
      ['src/a.ts'],
    )
    expect(result.clean).toBe(false)
    expect(result.unplannedPaths).toEqual(['src/secret.ts'])
  })

  it('empty plan treats all changes as unplanned', () => {
    const result = checkDiffPolicy(
      { filesDeleted: [], filesChanged: ['src/a.ts'] },
      [],
    )
    expect(result.unplannedPaths).toEqual(['src/a.ts'])
    expect(result.clean).toBe(false)
  })

  it('no changes is always clean', () => {
    const result = checkDiffPolicy({ filesDeleted: [], filesChanged: [] }, ['src/a.ts'])
    expect(result.clean).toBe(true)
  })
})
