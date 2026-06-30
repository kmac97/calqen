import { telegramOutbox } from './schema.js'
import type { DB, DBTransaction } from './db.js'

type DBOrTx = DB | DBTransaction

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
