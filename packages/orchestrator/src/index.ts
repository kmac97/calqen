import { orchestratorEnvSchema, validateEnv, closeDb } from '@calqen/shared'
import { startAllLoops, stopAllLoops } from './loop.js'

validateEnv(orchestratorEnvSchema, 'orchestrator')

startAllLoops()

async function shutdown() {
  stopAllLoops()
  await closeDb()
  console.log('[orchestrator] shutting down')
  process.exit(0)
}

process.on('SIGINT', () => { void shutdown() })
process.on('SIGTERM', () => { void shutdown() })
