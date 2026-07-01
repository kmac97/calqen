import { Bot } from 'grammy'
import { botEnvSchema, validateEnv } from '@calqen/shared'

validateEnv(botEnvSchema, 'bot')

const bot = new Bot(process.env['TELEGRAM_BOT_TOKEN']!)

const authorizedUserIds = process.env['AUTHORIZED_TELEGRAM_USER_IDS']!
  .split(',').map((id) => parseInt(id.trim(), 10))
const authorizedChatIds = process.env['AUTHORIZED_TELEGRAM_CHAT_IDS']!
  .split(',').map((id) => parseInt(id.trim(), 10))

const API = process.env['CALQEN_API_URL'] ?? 'http://localhost:3001'
const BOT_TOKEN = process.env['CALQEN_BOT_SERVICE_TOKEN']!

// Both user ID and chat ID must be authorized — silent drop otherwise
bot.use(async (ctx, next) => {
  const userId = ctx.from?.id
  const chatId = ctx.chat?.id
  if (!userId || !chatId || !authorizedUserIds.includes(userId) || !authorizedChatIds.includes(chatId)) return
  return await next()
})

function api(method: string, path: string, body?: unknown): Promise<Response> {
  const init: RequestInit = { method, headers: { Authorization: `Bearer ${BOT_TOKEN}`, 'Content-Type': 'application/json' } }
  if (body !== undefined) init.body = JSON.stringify(body)
  return fetch(`${API}${path}`, init)
}

// Queue a simple one-off message through the outbox
async function queueMessage(chatId: number, content: string) {
  await api('POST', '/api/bot/message', { chatId, content })
}

bot.command('approve', async (ctx) => {
  const taskId = ctx.match.trim()
  if (!taskId) { await queueMessage(ctx.chat.id, 'Usage: /approve <taskId>'); return }
  await api('POST', `/api/tasks/${taskId}/approve`)
})

bot.command('reject', async (ctx) => {
  const taskId = ctx.match.trim()
  if (!taskId) { await queueMessage(ctx.chat.id, 'Usage: /reject <taskId>'); return }
  await api('POST', `/api/tasks/${taskId}/reject`)
})

bot.command('cancel', async (ctx) => {
  const taskId = ctx.match.trim()
  if (!taskId) { await queueMessage(ctx.chat.id, 'Usage: /cancel <taskId>'); return }
  await api('POST', `/api/tasks/${taskId}/cancel`)
})

bot.command('status', async (ctx) => {
  const taskId = ctx.match.trim()
  if (!taskId) { await queueMessage(ctx.chat.id, 'Usage: /status <taskId>'); return }
  await api('POST', `/api/bot/tasks/${taskId}/status-message`, { chatId: ctx.chat.id })
})

bot.on('message:text', async (ctx) => {
  const chatId = ctx.chat.id
  const text = ctx.message.text

  // Check for pending clarification
  const convRes = await api('GET', `/api/bot/conversation/${chatId}`)
  if (convRes.ok) {
    const convBody = await convRes.json() as { conversation: { awaitingTaskId: string } | null }
    if (convBody.conversation?.awaitingTaskId) {
      await api('POST', `/api/tasks/${convBody.conversation.awaitingTaskId}/clarification`, { reply: text })
      return
    }
  }

  await api('POST', '/api/tasks', {
    rawInput: text,
    telegramChatId: chatId,
    telegramMessageId: ctx.message.message_id,
  })
})

async function pollOutbox() {
  try {
    const res = await api('GET', '/api/bot/pending-messages')
    if (!res.ok) return
    const body = await res.json() as {
      messages: Array<{
        id: string
        chatId: number
        content: string
        replyToMessageId: number | null
        deliveryLeaseId: string
      }>
    }
    for (const msg of body.messages) {
      try {
        if (msg.replyToMessageId) {
          await bot.api.sendMessage(msg.chatId, msg.content, { reply_parameters: { message_id: msg.replyToMessageId } })
        } else {
          await bot.api.sendMessage(msg.chatId, msg.content)
        }
        await api('POST', `/api/bot/messages/${msg.id}/sent`, { deliveryLeaseId: msg.deliveryLeaseId })
      } catch (err) {
        console.error(`[outbox] failed to send ${msg.id}:`, err)
      }
    }
  } catch (err) {
    console.error('[outbox] poll error:', err)
  }
}

const outboxInterval = setInterval(() => { void pollOutbox() }, 3000)

async function shutdown() {
  clearInterval(outboxInterval)
  await bot.stop()
  console.log('[bot] shutting down')
}

process.on('SIGINT', () => { void shutdown() })
process.on('SIGTERM', () => { void shutdown() })

await bot.start()
