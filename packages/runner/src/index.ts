import { readFileSync, writeFileSync, existsSync } from 'fs'
import type { BuilderOutput, Task, TaskPlanRow, Artifact } from '@calqen/shared'
import { createApi, type RunnerToken } from './api.js'
import { runBuilder } from './agents/builder.js'
import { runVerifier } from './agents/verifier.js'
import { checkDiffPolicy, isProtectedBranch } from './policy.js'

const API_BASE = process.env['CALQEN_API_URL'] ?? 'http://localhost:3001'
const TOKEN_PATH = process.env['RUNNER_TOKEN_PATH'] ?? '.runner-token'
const RUNNER_NAME = process.env['RUNNER_NAME'] ?? `runner-${process.platform}`
const POLL_MS = 10000
const HEARTBEAT_MS = 20000

type PollTask = Task & { project: object | null; plan: TaskPlanRow | null; diffArtifact: Artifact | null }

async function register(): Promise<RunnerToken> {
  const res = await fetch(`${API_BASE}/api/runner/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: RUNNER_NAME,
      platform: process.platform,
      registrationSecret: process.env['RUNNER_REGISTRATION_SECRET']!,
    }),
  })
  if (!res.ok) throw new Error(`Registration failed (${res.status}): ${await res.text()}`)
  return res.json() as Promise<RunnerToken>
}

async function loadToken(): Promise<RunnerToken> {
  if (existsSync(TOKEN_PATH)) {
    return JSON.parse(readFileSync(TOKEN_PATH, 'utf-8')) as RunnerToken
  }
  const token = await register()
  writeFileSync(TOKEN_PATH, JSON.stringify(token), 'utf-8')
  console.log(`[runner] registered as ${token.runnerId}`)
  return token
}

async function executeTask(task: PollTask, api: ReturnType<typeof createApi>) {
  const taskId = task.id
  const leaseId = task.leaseId!
  const plan = task.plan
  const shortId = taskId.slice(0, 8)

  console.log(`[runner] executing task ${shortId} — ${task.title}`)

  // Check cancel before starting
  if (task.cancelRequestedAt) {
    await api.fail(taskId, leaseId, 'cancelled_by_user')
    return
  }

  // Branch protection — Phase 1 uses simulated branch name
  const branchName = task.branchName ?? `calqen/${shortId}`
  if (isProtectedBranch(branchName)) {
    await api.fail(taskId, leaseId, 'unplanned_protected_path', 'init')
    return
  }

  let builderOutput: BuilderOutput

  if (task.resumeStage === 'verify') {
    // Resuming after deletion approval — load stored diff artifact
    if (!task.diffArtifact) {
      console.error(`[runner] resume_stage=verify but no diff artifact for task ${shortId}`)
      await api.fail(taskId, leaseId, 'failed', 'verify')
      return
    }
    builderOutput = JSON.parse(task.diffArtifact.content) as BuilderOutput
    await api.progress(taskId, leaseId, 'verify', 'Resuming from stored diff after deletion approval')
  } else {
    // Build stage
    await api.progress(taskId, leaseId, 'build', 'Starting mock build')

    // Check cancel before build
    if (task.cancelRequestedAt) {
      await api.fail(taskId, leaseId, 'cancelled_by_user')
      return
    }

    builderOutput = await runBuilder(plan?.filesAffected ?? [], task.goal ?? task.title)
    await api.progress(taskId, leaseId, 'build', `Build complete — ${builderOutput.filesChanged.length} file(s)`)

    // Diff policy check
    const policy = checkDiffPolicy(builderOutput, plan?.filesAffected ?? [])

    if (policy.deletedFiles.length > 0) {
      console.log(`[runner] deletions detected in task ${shortId}: ${policy.deletedFiles.join(', ')}`)
      await api.deletionDetected(taskId, leaseId, policy.deletedFiles, builderOutput.diff)
      return
    }

    if (policy.unplannedPaths.length > 0) {
      console.log(`[runner] unplanned paths in task ${shortId}: ${policy.unplannedPaths.join(', ')}`)
      await api.fail(taskId, leaseId, 'unplanned_protected_path', 'policy')
      return
    }
  }

  // Verify stage
  await api.progress(taskId, leaseId, 'verify', 'Running verification')
  const verifyResult = await runVerifier(builderOutput.filesChanged, plan?.testPlan ?? '')

  await api.complete(taskId, leaseId, {
    diffSummary: `${builderOutput.filesChanged.length} files (mock dry-run)`,
    filesChanged: builderOutput.filesChanged,
    filesCreated: builderOutput.filesCreated,
    filesModified: builderOutput.filesModified,
    filesDeleted: builderOutput.filesDeleted,
    testOutput: verifyResult.testOutput,
    passed: verifyResult.passed,
  })

  console.log(`[runner] task ${shortId} ${verifyResult.passed ? 'completed' : 'failed'}`)
}

async function poll(api: ReturnType<typeof createApi>) {
  const res = await api.poll()
  if (!res.ok) {
    console.error(`[runner] poll failed (${res.status})`)
    return
  }
  const body = await res.json() as { task: PollTask | null }
  if (!body.task) return

  const task = body.task
  const leaseId = task.leaseId!

  // Heartbeat loop
  const heartbeat = setInterval(() => {
    api.heartbeat(leaseId).catch((err: unknown) => console.error('[runner] heartbeat error:', err))
  }, HEARTBEAT_MS)

  try {
    await executeTask(task, api)
  } catch (err) {
    console.error(`[runner] task ${task.id.slice(0, 8)} unhandled error:`, err)
    await api.fail(task.id, leaseId, 'failed').catch(() => undefined)
  } finally {
    clearInterval(heartbeat)
  }
}

async function main() {
  const token = await loadToken()
  const api = createApi(token, API_BASE)
  console.log(`[runner] ${token.runnerId.slice(0, 8)} — polling ${API_BASE} every ${POLL_MS}ms`)

  const tick = async () => {
    try { await poll(api) } catch (err) { console.error('[runner] poll error:', err) }
    setTimeout(() => { void tick() }, POLL_MS)
  }
  void tick()
}

await main()
