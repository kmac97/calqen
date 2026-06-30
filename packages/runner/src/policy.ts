const PROTECTED_BRANCHES = new Set(['main', 'master', 'develop', 'production', 'prod'])

export function isProtectedBranch(branch: string): boolean {
  return PROTECTED_BRANCHES.has(branch)
}

export interface PolicyResult {
  deletedFiles: string[]
  unplannedPaths: string[]
  clean: boolean
}

export function checkDiffPolicy(
  diff: { filesDeleted: string[]; filesChanged: string[] },
  filesAffected: string[],
): PolicyResult {
  const planned = new Set(filesAffected)
  const deletedFiles = diff.filesDeleted
  const unplannedPaths = diff.filesChanged.filter((f) => !planned.has(f))

  return {
    deletedFiles,
    unplannedPaths,
    clean: deletedFiles.length === 0 && unplannedPaths.length === 0,
  }
}
