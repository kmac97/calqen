import { z } from 'zod'

export const projectSettingsSchema = z.object({
  packageManager: z.string().default('pnpm'),
  testCommand: z.string().default('pnpm test'),
  typecheckCommand: z.string().default('pnpm typecheck'),
  lintCommand: z.string().default('pnpm lint'),
  protectedPathGlobs: z.array(z.string()).default([
    '.github/**',
    '**/migrations/**',
    'Dockerfile',
    'docker-compose*.yml',
    '.env*',
    '*.config.ts',
    '.railway.toml',
  ]),
  repositoryRulesPath: z.string().default('CLAUDE.md'),
})

export type ProjectSettings = z.infer<typeof projectSettingsSchema>

export const createProjectSchema = z.object({
  name: z.string().min(1),
  githubRepo: z.string().min(1),
  githubDefaultBranch: z.string().default('main'),
  localPath: z.string().optional(),
  stack: z.string().optional(),
  settings: projectSettingsSchema.optional(),
})
