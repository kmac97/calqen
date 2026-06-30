import type { BuilderOutput } from '@calqen/shared'

export async function runBuilder(filesAffected: string[], goal: string): Promise<BuilderOutput> {
  console.log('[BUILDER MOCK] simulating build (2s)...')
  await new Promise<void>((resolve) => setTimeout(resolve, 2000))

  const goalSnippet = goal.slice(0, 50)
  const filesModified = filesAffected.filter((f) => !f.includes('(new)'))
  const filesCreated: string[] = []
  const filesDeleted: string[] = []

  const diff = filesModified
    .map((f) => `--- a/${f}\n+++ b/${f}\n@@ -1,1 +1,1 @@\n-// original\n+// ${goalSnippet}\n`)
    .join('\n')

  const filesChanged = [...filesModified, ...filesCreated, ...filesDeleted]

  return { diff, filesChanged, filesCreated, filesModified, filesDeleted }
}
