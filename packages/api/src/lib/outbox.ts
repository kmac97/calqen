import { telegramOutbox, type DBTransaction, db } from '@calqen/shared'

type DBOrTX = typeof db | DBTransaction

interface OutboxParams {
  chatId: number
  taskId?: string | null
  messageType: string
  content: string
  dedupeKey?: string | null
  replyToMessageId?: number | null
}

export async function queueMessage(dbOrTx: DBOrTX, params: OutboxParams): Promise<void> {
  await (dbOrTx as typeof db)
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
