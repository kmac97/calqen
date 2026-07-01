import { telegramOutbox } from './schema.js'
import type { DB, DBTransaction } from './db.js'

type DBOrTx = DB | DBTransaction

// Appended to a task's rawInput each time the user replies to a clarifying question
// (packages/api/src/routes/bot.ts) and counted back out to derive the clarification round
// number for dedupe keys (packages/orchestrator/src/loop.ts) — shared here so the two stay in sync.
export const CLARIFICATION_MARKER = '\n[clarification]: '

// Appended to tasks.constraints by classifyLoop when the classifier detects a technical
// comparison request (packages/orchestrator/src/loop.ts), and read back out by research.ts to
// select technical vs commercial research mode. tasks.taskType is a real Postgres enum, so adding
// a value there would need a migration — reusing the existing constraints[] text column with a
// shared marker constant avoids that, same pattern as CLARIFICATION_MARKER above. Stripped from
// the constraints list before it reaches the research prompt, so the model never sees it.
export const TECHNICAL_COMPARISON_MARKER = '__calqen_internal:technical_comparison__'

export interface OutboxParams {
  chatId: number
  taskId?: string | null
  messageType: string
  content: string
  dedupeKey?: string | null
  replyToMessageId?: number | null
}

export async function queueMessage(dbOrTx: DBOrTx, params: OutboxParams) {
  await dbOrTx
    .insert(telegramOutbox)
    .values({
      chatId: params.chatId,
      taskId: params.taskId ?? null,
      messageType: params.messageType,
      content: params.content,
      dedupeKey: params.dedupeKey ?? null,
      replyToMessageId: params.replyToMessageId ?? null,
    })
    .onConflictDoNothing()
}
