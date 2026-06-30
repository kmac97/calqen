const PROTECTED_BRANCHES = new Set(['main', 'master', 'develop', 'production', 'prod'])

export function isProtectedBranch(branch: string): boolean {
  return PROTECTED_BRANCHES.has(branch)
}

export interface PolicyResult {
  deletedFiles: string[]
  unplannedPaths: string[]
  clean: boolean
}

// Minimal glob → regex: supports * (non-separator) and ** (any path)
function matchesGlob(filePath: string, pattern: string): boolean {
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // escape regex specials except *
    .replace(/\*\*/g, '\x00')              // placeholder for **
    .replace(/\*/g, '[^/]*')              // * matches within one segment
    .replace(/\x00/g, '.*')               // ** matches any path
  return new RegExp(`^${regexStr}$`).test(filePath)
}

export function checkDiffPolicy(
  diff: { filesDeleted: string[]; filesChanged: string[] },
  filesAffected: string[],
  protectedPathGlobs: string[] = [],
): PolicyResult {
  const planned = new Set(filesAffected)
  const deletedFiles = diff.filesDeleted

  const unplannedPaths = diff.filesChanged.filter(
    (f) => !planned.has(f) || protectedPathGlobs.some((glob) => matchesGlob(f, glob)),
  )

  return {
    deletedFiles,
    unplannedPaths,
    clean: deletedFiles.length === 0 && unplannedPaths.length === 0,
  }
}
