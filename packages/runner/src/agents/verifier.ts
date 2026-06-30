import type { VerifierOutput } from '@calqen/shared'

export async function runVerifier(filesChanged: string[], testPlan: string): Promise<VerifierOutput> {
  console.log('[VERIFIER MOCK] running verification...')

  return {
    passed: true,
    testOutput: `[VERIFIER MOCK] ${filesChanged.length} file(s) reviewed. Plan: ${testPlan}`,
    summary: 'All mock checks passed',
  }
}
