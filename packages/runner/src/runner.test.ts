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

// Fix #9: protectedPathGlobs glob matching
describe('checkDiffPolicy with protectedPathGlobs', () => {
  it('blocks planned file matching protected glob', () => {
    const result = checkDiffPolicy(
      { filesDeleted: [], filesChanged: ['.github/workflows/ci.yml'] },
      ['.github/workflows/ci.yml'],
      ['.github/**'],
    )
    expect(result.clean).toBe(false)
    expect(result.unplannedPaths).toContain('.github/workflows/ci.yml')
  })

  it('blocks file matching ** pattern', () => {
    const result = checkDiffPolicy(
      { filesDeleted: [], filesChanged: ['packages/shared/src/migrations/0001.sql'] },
      ['packages/shared/src/migrations/0001.sql'],
      ['**/migrations/**'],
    )
    expect(result.clean).toBe(false)
    expect(result.unplannedPaths).toContain('packages/shared/src/migrations/0001.sql')
  })

  it('blocks exact filename match', () => {
    const result = checkDiffPolicy(
      { filesDeleted: [], filesChanged: ['Dockerfile'] },
      ['Dockerfile'],
      ['Dockerfile'],
    )
    expect(result.clean).toBe(false)
    expect(result.unplannedPaths).toContain('Dockerfile')
  })

  it('blocks wildcard prefix pattern (.env*)', () => {
    const result = checkDiffPolicy(
      { filesDeleted: [], filesChanged: ['.env.local'] },
      ['.env.local'],
      ['.env*'],
    )
    expect(result.clean).toBe(false)
    expect(result.unplannedPaths).toContain('.env.local')
  })

  it('blocks wildcard suffix pattern (*.config.ts)', () => {
    const result = checkDiffPolicy(
      { filesDeleted: [], filesChanged: ['vite.config.ts'] },
      ['vite.config.ts'],
      ['*.config.ts'],
    )
    expect(result.clean).toBe(false)
    expect(result.unplannedPaths).toContain('vite.config.ts')
  })

  it('allows file not matching any glob', () => {
    const result = checkDiffPolicy(
      { filesDeleted: [], filesChanged: ['src/a.ts'] },
      ['src/a.ts'],
      ['.github/**', 'Dockerfile', '.env*'],
    )
    expect(result.clean).toBe(true)
  })

  it('empty protectedPathGlobs has no effect', () => {
    const result = checkDiffPolicy(
      { filesDeleted: [], filesChanged: ['src/a.ts'] },
      ['src/a.ts'],
      [],
    )
    expect(result.clean).toBe(true)
  })

  it('glob only blocks matching files, not all files', () => {
    const result = checkDiffPolicy(
      { filesDeleted: [], filesChanged: ['src/a.ts', '.github/workflows/ci.yml'] },
      ['src/a.ts', '.github/workflows/ci.yml'],
      ['.github/**'],
    )
    expect(result.clean).toBe(false)
    expect(result.unplannedPaths).toEqual(['.github/workflows/ci.yml'])
    // src/a.ts is allowed
  })
})
