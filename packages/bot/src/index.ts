import { Bot } from 'grammy'

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
  await next()
})

function api(method: string, path: string, body?: unknown): Promise<Response> {
  const init: RequestInit = { method, headers: { Authorization: `Bearer ${BOT_TOKEN}`, 'Content-Type': 'application/json' } }
  if (body !== undefined) init.body = JSON.stringify(body)
  return fetch(`${API}${path}`, init)
}

bot.command('approve', async (ctx) => {
  const taskId = ctx.match.trim()
  if (!taskId) { await ctx.reply('Usage: /approve <taskId>'); return }
  const res = await api('POST', `/api/tasks/${taskId}/approve`)
  await ctx.reply(res.ok ? '✅ Approved' : `❌ Failed (${res.status})`)
})

bot.command('reject', async (ctx) => {
  const taskId = ctx.match.trim()
  if (!taskId) { await ctx.reply('Usage: /reject <taskId>'); return }
  const res = await api('POST', `/api/tasks/${taskId}/reject`)
  await ctx.reply(res.ok ? '✅ Rejected' : `❌ Failed (${res.status})`)
})

bot.command('cancel', async (ctx) => {
  const taskId = ctx.match.trim()
  if (!taskId) { await ctx.reply('Usage: /cancel <taskId>'); return }
  const res = await api('POST', `/api/tasks/${taskId}/cancel`)
  await ctx.reply(res.ok ? '🚫 Cancel requested' : `❌ Failed (${res.status})`)
})

bot.command('status', async (ctx) => {
  const taskId = ctx.match.trim()
  if (!taskId) { await ctx.reply('Usage: /status <taskId>'); return }
  const res = await api('GET', `/api/tasks/${taskId}`)
  if (!res.ok) { await ctx.reply('❌ Not found'); return }
  const body = await res.json() as { task: { status: string; title: string; spentUsd: string } }
  await ctx.reply(`📊 ${body.task.title}\nStatus: ${body.task.status}\nSpent: $${body.task.spentUsd}`)
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
      }>
    }
    for (const msg of body.messages) {
      try {
        if (msg.replyToMessageId) {
          await bot.api.sendMessage(msg.chatId, msg.content, { reply_parameters: { message_id: msg.replyToMessageId } })
        } else {
          await bot.api.sendMessage(msg.chatId, msg.content)
        }
        await api('POST', `/api/bot/messages/${msg.id}/sent`)
      } catch (err) {
        console.error(`[outbox] failed to send ${msg.id}:`, err)
      }
    }
  } catch (err) {
    console.error('[outbox] poll error:', err)
  }
}

setInterval(() => { void pollOutbox() }, 3000)

await bot.start()
