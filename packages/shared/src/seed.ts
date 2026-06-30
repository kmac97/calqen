import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { projects, runners, tasks } from './schema.js'
import type { ProjectSettings } from './schemas/project.js'
import { sql } from 'drizzle-orm'

const DEFAULT_SETTINGS: ProjectSettings = {
  packageManager: 'pnpm',
  testCommand: 'pnpm test',
  typecheckCommand: 'pnpm typecheck',
  lintCommand: 'pnpm lint',
  protectedPathGlobs: ['.github/**', '**/migrations/**', '.env*', 'Dockerfile'],
  repositoryRulesPath: 'CLAUDE.md',
}

async function main() {
  const url = process.env['MIGRATIONS_DATABASE_URL'] ?? process.env['DATABASE_URL']
  if (!url) throw new Error('DATABASE_URL or MIGRATIONS_DATABASE_URL is required')

  const client = postgres(url, { prepare: false, max: 1 })
  const db = drizzle(client)

  console.log('Seeding projects...')

  const [thesis, , brightTop] = await db
    .insert(projects)
    .values([
      {
        name: 'Thesis',
        githubRepo: 'kmac97/thesis',
        githubDefaultBranch: 'main',
        stack: 'Trading and journaling app',
        settings: DEFAULT_SETTINGS,
      },
      {
        name: 'MerchantMind',
        githubRepo: 'kmac97/merchantmind',
        githubDefaultBranch: 'main',
        stack: 'Merchant tools',
        settings: DEFAULT_SETTINGS,
      },
      {
        name: 'Bright Top Roofing',
        githubRepo: 'kmac97/bright-top-roofing',
        githubDefaultBranch: 'main',
        stack: 'Roofing tools',
        settings: DEFAULT_SETTINGS,
      },
    ])
    .onConflictDoNothing()
    .returning()

  console.log('Seeding tasks...')

  if (thesis) {
    await db
      .insert(tasks)
      .values([
        {
          projectId: thesis.id,
          title: 'Add drag-to-reorder watchlist to Thesis',
          rawInput: 'Add a watchlist to Thesis with drag-to-reorder',
          goal: 'Implement a drag-to-reorder watchlist feature',
          taskType: 'feature',
          executionTarget: 'runner',
          status: 'completed',
          telegramChatId: 0,
          budgetUsd: '2.0000',
          spentUsd: '0.0000',
        },
        {
          projectId: null,
          title: 'Research best charting libraries for trading apps',
          rawInput: 'Research best charting libraries for trading apps',
          goal: 'Identify the best charting library options',
          taskType: 'research',
          executionTarget: 'orchestrator',
          status: 'completed',
          requiresApproval: false,
          telegramChatId: 0,
          budgetUsd: '2.0000',
          spentUsd: '0.0000',
        },
      ])
      .onConflictDoNothing()
  } else {
    console.log('Thesis project already exists, inserting tasks with subquery...')
    const thesisRow = await db.execute(
      sql`SELECT id FROM projects WHERE github_repo = 'kmac97/thesis' LIMIT 1`,
    )
    const thesisId = (thesisRow[0] as { id: string } | undefined)?.id
    if (thesisId) {
      await db
        .insert(tasks)
        .values([
          {
            projectId: thesisId,
            title: 'Add drag-to-reorder watchlist to Thesis',
            rawInput: 'Add a watchlist to Thesis with drag-to-reorder',
            goal: 'Implement a drag-to-reorder watchlist feature',
            taskType: 'feature',
            executionTarget: 'runner',
            status: 'completed',
            telegramChatId: 0,
            budgetUsd: '2.0000',
            spentUsd: '0.0000',
          },
        ])
        .onConflictDoNothing()
    }
    await db
      .insert(tasks)
      .values({
        projectId: null,
        title: 'Research best charting libraries for trading apps',
        rawInput: 'Research best charting libraries for trading apps',
        goal: 'Identify the best charting library options',
        taskType: 'research',
        executionTarget: 'orchestrator',
        status: 'completed',
        requiresApproval: false,
        telegramChatId: 0,
        budgetUsd: '2.0000',
        spentUsd: '0.0000',
      })
      .onConflictDoNothing()
  }

  console.log('Seeding runner...')
  if (brightTop) {
    // brightTop confirmed seeded, runner uses a placeholder hash
    await db
      .insert(runners)
      .values({
        name: 'kaine-windows-pc',
        tokenHash: '$2b$12$placeholder_seed_hash_not_usable',
        platform: 'windows',
        status: 'offline',
      })
      .onConflictDoNothing()
  } else {
    await db
      .insert(runners)
      .values({
        name: 'kaine-windows-pc',
        tokenHash: '$2b$12$placeholder_seed_hash_not_usable',
        platform: 'windows',
        status: 'offline',
      })
      .onConflictDoNothing()
  }

  console.log('Seed complete.')
  await client.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
