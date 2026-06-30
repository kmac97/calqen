import { describe, it, expect } from 'vitest'
import { app } from './app.js'
import { db, tasks, runners, taskPlans, approvals, artifacts, computeScopeHash, planHashPayload, deletionHashPayload } from '@calqen/shared'
import { eq } from 'drizzle-orm'

const BOT_TOKEN = process.env['CALQEN_BOT_SERVICE_TOKEN']!
const REG_SECRET = process.env['RUNNER_REGISTRATION_SECRET']!
const HAS_REAL_DB = !!process.env['DATABASE_URL'] && process.env['DATABASE_URL'] !== 'postgres://fake:fake@localhost:5432/fake'

// ── Auth: no DB required ───────────────────────────────────────────────────

describe('GET /api/health', () => {
  it('returns 200', async () => {
    const res = await app.request('/api/health')
    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean }
    expect(body.ok).toBe(true)
  })
})

describe('Bot auth', () => {
  it('returns 401 without Authorization header', async () => {
    const res = await app.request('/api/tasks')
    expect(res.status).toBe(401)
  })

  it('returns 401 with wrong token', async () => {
    const res = await app.request('/api/tasks', {
      headers: { Authorization: 'Bearer wrong-token' },
    })
    expect(res.status).toBe(401)
  })

  it('returns 401 with malformed header', async () => {
    const res = await app.request('/api/tasks', {
      headers: { Authorization: 'Basic abc123' },
    })
    expect(res.status).toBe(401)
  })
})

describe('Runner auth', () => {
  it('returns 401 without Authorization header', async () => {
    const res = await app.request('/api/runner/poll')
    expect(res.status).toBe(401)
  })

  it('returns 401 without X-Runner-ID header', async () => {
    const res = await app.request('/api/runner/poll', {
      headers: { Authorization: 'Bearer some-token' },
    })
    expect(res.status).toBe(401)
  })
})

describe('Registration auth', () => {
  it('returns 401 with wrong registration secret', async () => {
    const res = await app.request('/api/runner/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'test', platform: 'windows', registrationSecret: 'wrong' }),
    })
    expect(res.status).toBe(401)
  })
})

describe('Registration rate limit', () => {
  it('returns 429 after 5 attempts from the same IP', async () => {
    const ip = `10.rate.${Date.now()}.1` // unique per test run

    for (let i = 0; i < 5; i++) {
      await app.request('/api/runner/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
        body: JSON.stringify({ name: 'test', platform: 'windows', registrationSecret: 'wrong' }),
      })
    }

    const res = await app.request('/api/runner/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
      body: JSON.stringify({ name: 'test', platform: 'windows', registrationSecret: 'wrong' }),
    })
    expect(res.status).toBe(429)
  })
})

// Fix #2: deliveryLeaseId required on /sent
describe('POST /api/bot/messages/:id/sent', () => {
  it('returns 401 without bot auth', async () => {
    const res = await app.request('/api/bot/messages/fake-id/sent', { method: 'POST' })
    expect(res.status).toBe(401)
  })
})

// Fix #3: new bot endpoints exist and require auth
describe('POST /api/bot/message', () => {
  it('returns 401 without bot auth', async () => {
    const res = await app.request('/api/bot/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: 123, content: 'hi' }),
    })
    expect(res.status).toBe(401)
  })
})

describe('POST /api/bot/tasks/:id/status-message', () => {
  it('returns 401 without bot auth', async () => {
    const res = await app.request('/api/bot/tasks/fake-id/status-message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: 123 }),
    })
    expect(res.status).toBe(401)
  })
})

// Fix #8: cancel-check endpoint requires runner auth
describe('GET /api/runner/tasks/:id/cancel-check', () => {
  it('returns 401 without runner auth', async () => {
    const res = await app.request('/api/runner/tasks/fake-id/cancel-check')
    expect(res.status).toBe(401)
  })
})

// ── Integration tests: require real DB ────────────────────────────────────

describe.skipIf(!HAS_REAL_DB)('Registration (integration)', () => {
  it('returns runnerId and runnerToken with correct secret', async () => {
    const res = await app.request('/api/runner/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `test-runner-${Date.now()}`,
        platform: 'windows',
        registrationSecret: REG_SECRET,
      }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as { runnerId: string; runnerToken: string }
    expect(body.runnerId).toMatch(/^[0-9a-f-]{36}$/)
    expect(body.runnerToken).toMatch(/^[0-9a-f]{64}$/)

    // cleanup
    await db.delete(runners).where(eq(runners.id, body.runnerId))
  })
})

describe.skipIf(!HAS_REAL_DB)('/approve scope_hash verification (integration)', () => {
  it('returns 409 when scope_hash does not match current plan', async () => {
    // Create a task
    const [task] = await db
      .insert(tasks)
      .values({
        rawInput: 'test task',
        title: 'test task',
        telegramChatId: 0,
        status: 'awaiting_approval',
        taskType: 'feature',
        executionTarget: 'runner',
      })
      .returning()

    expect(task).toBeDefined()
    if (!task) throw new Error('task not created')

    // Create a plan
    const fakePlan = {
      filesAffected: ['src/foo.ts'],
      proposedChanges: [],
      containsDeletions: false,
      risks: [],
      testPlan: 'run tests',
      version: 1,
    }
    const [plan] = await db
      .insert(taskPlans)
      .values({
        taskId: task.id,
        ...fakePlan,
        scopeHash: computeScopeHash(planHashPayload(fakePlan)),
      })
      .returning()

    expect(plan).toBeDefined()
    if (!plan) throw new Error('plan not created')

    // Create an approval with a WRONG scope_hash
    await db.insert(approvals).values({
      taskId: task.id,
      type: 'plan_approval',
      planVersion: 1,
      scopeHash: 'wrong-hash-that-does-not-match',
    })

    const res = await app.request(`/api/tasks/${task.id}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${BOT_TOKEN}` },
    })
    expect(res.status).toBe(409)

    // cleanup
    await db.delete(approvals).where(eq(approvals.taskId, task.id))
    await db.delete(taskPlans).where(eq(taskPlans.taskId, task.id))
    await db.delete(tasks).where(eq(tasks.id, task.id))
  })
})

// Fix #6: deletion approval uses deletion-specific scope_hash
describe.skipIf(!HAS_REAL_DB)('/approve deletion scope_hash (integration)', () => {
  it('returns 409 when deletion scope_hash does not match artifact+files', async () => {
    const [task] = await db
      .insert(tasks)
      .values({
        rawInput: 'deletion test task',
        title: 'deletion test task',
        telegramChatId: 0,
        status: 'awaiting_approval',
        taskType: 'feature',
        executionTarget: 'runner',
      })
      .returning()

    if (!task) throw new Error('task not created')

    // Create diff artifact
    const artifactContent = JSON.stringify({ filesChanged: [], filesCreated: [], filesModified: [], filesDeleted: ['src/old.ts'], diff: '' })
    const [artifact] = await db
      .insert(artifacts)
      .values({ taskId: task.id, type: 'diff', content: artifactContent, metadata: { filesDeleted: ['src/old.ts'] } })
      .returning()

    if (!artifact) throw new Error('artifact not created')

    // Create deletion approval with a WRONG scope_hash
    await db.insert(approvals).values({
      taskId: task.id,
      type: 'deletion',
      planVersion: 1,
      scopeHash: 'deliberately-wrong-hash',
      filesToDelete: ['src/old.ts'],
    })

    const res = await app.request(`/api/tasks/${task.id}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${BOT_TOKEN}` },
    })
    expect(res.status).toBe(409)

    // cleanup
    await db.delete(approvals).where(eq(approvals.taskId, task.id))
    await db.delete(artifacts).where(eq(artifacts.taskId, task.id))
    await db.delete(tasks).where(eq(tasks.id, task.id))
  })

  it('returns 200 when deletion scope_hash matches artifact+files', async () => {
    const [task] = await db
      .insert(tasks)
      .values({
        rawInput: 'deletion match test',
        title: 'deletion match test',
        telegramChatId: 0,
        status: 'awaiting_approval',
        taskType: 'feature',
        executionTarget: 'runner',
      })
      .returning()

    if (!task) throw new Error('task not created')

    const artifactContent = JSON.stringify({ filesChanged: [], filesCreated: [], filesModified: [], filesDeleted: ['src/old.ts'], diff: '' })
    await db
      .insert(artifacts)
      .values({ taskId: task.id, type: 'diff', content: artifactContent, metadata: { filesDeleted: ['src/old.ts'] } })

    const correctHash = computeScopeHash(deletionHashPayload(['src/old.ts'], artifactContent))

    await db.insert(approvals).values({
      taskId: task.id,
      type: 'deletion',
      planVersion: 1,
      scopeHash: correctHash,
      filesToDelete: ['src/old.ts'],
    })

    const res = await app.request(`/api/tasks/${task.id}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${BOT_TOKEN}` },
    })
    expect(res.status).toBe(200)

    // cleanup
    await db.delete(approvals).where(eq(approvals.taskId, task.id))
    await db.delete(artifacts).where(eq(artifacts.taskId, task.id))
    await db.delete(tasks).where(eq(tasks.id, task.id))
  })
})

describe.skipIf(!HAS_REAL_DB)('Concurrent poll (integration)', () => {
  it('only one of two concurrent polls claims the queued task', async () => {
    // Register a temporary runner
    const regRes = await app.request('/api/runner/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `concurrent-test-${Date.now()}`,
        platform: 'windows',
        registrationSecret: REG_SECRET,
      }),
    })
    const { runnerId, runnerToken } = await regRes.json() as { runnerId: string; runnerToken: string }

    // Create a queued task
    const [task] = await db
      .insert(tasks)
      .values({
        rawInput: 'concurrent test task',
        title: 'concurrent test task',
        telegramChatId: 0,
        status: 'queued',
        taskType: 'feature',
        executionTarget: 'runner',
      })
      .returning()

    expect(task).toBeDefined()
    if (!task) throw new Error('task not created')

    const headers = { Authorization: `Bearer ${runnerToken}`, 'X-Runner-ID': runnerId }

    // Two simultaneous polls
    const [r1, r2] = await Promise.all([
      app.request('/api/runner/poll', { headers }),
      app.request('/api/runner/poll', { headers }),
    ])

    const b1 = await r1.json() as { task: unknown }
    const b2 = await r2.json() as { task: unknown }

    const claimed = [b1.task, b2.task].filter(Boolean)
    expect(claimed.length).toBe(1) // exactly one claimed the task

    // cleanup
    await db.delete(tasks).where(eq(tasks.id, task.id))
    await db.delete(runners).where(eq(runners.id, runnerId))
  })
})
