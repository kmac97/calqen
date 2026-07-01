import { telegramOutbox } from './schema.js'
import type { DB, DBTransaction } from './db.js'

type DBOrTx = DB | DBTransaction

// Appended to a task's rawInput each time the user replies to a clarifying question
// (packages/api/src/routes/bot.ts) and counted back out to derive the clarification round
// number for dedupe keys (packages/orchestrator/src/loop.ts) — shared here so the two stay in sync.
export const CLARIFICATION_MARKER = '\n[clarification]: '

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
