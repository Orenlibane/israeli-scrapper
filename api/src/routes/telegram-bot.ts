/**
 * Telegram bot webhook handler.
 * Register webhook once with:
 *   curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://api-production.up.railway.app/telegram/webhook"
 *
 * Commands:
 *   /help        — list commands
 *   /cities      — list available cities
 *   /search <city> [rooms] [sale|rent] — top 5 listings
 *   /top <city>  — 5 best-value (deals first)
 *   /stats       — DB summary
 */

import type { FastifyInstance } from 'fastify'
import { prisma } from '../index'

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!

const CITY_ALIASES: Record<string, number> = {
  'tel aviv': 5000, 'תל אביב': 5000, 'ta': 5000,
  'jerusalem': 3000, 'ירושלים': 3000, 'jlm': 3000,
  'haifa': 4000, 'חיפה': 4000,
  'rishon': 8300, 'rishon lezion': 8300, 'ראשון לציון': 8300,
  'petah tikva': 7900, 'פתח תקווה': 7900,
  'ashdod': 70, 'אשדוד': 70,
  'netanya': 7400, 'נתניה': 7400,
  'beer sheva': 9000, 'be\'er sheva': 9000, 'באר שבע': 9000,
  'holon': 6600, 'חולון': 6600,
  'bnei brak': 6200, 'בני ברק': 6200,
  'ramat gan': 8600, 'רמת גן': 8600,
  'herzliya': 6400, 'הרצליה': 6400,
  'kfar saba': 6900, 'כפר סבא': 6900,
  'rehovot': 8400, 'רחובות': 8400,
  "modi'in": 1200, 'modiin': 1200, 'מודיעין': 1200,
  "ra'anana": 8700, 'raanana': 8700, 'רעננה': 8700,
  'ashkelon': 650, 'אשקלון': 650,
  'bat yam': 6300, 'בת ים': 6300,
}

async function reply(chatId: number, text: string) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
  })
}

function formatPrice(p: number): string {
  if (p >= 1_000_000) return '₪' + (p / 1_000_000).toFixed(2).replace(/\.?0+$/, '') + 'M'
  if (p >= 1_000)     return '₪' + Math.round(p / 1_000) + 'K'
  return '₪' + p
}

function formatListing(l: {
  cityRaw: string | null
  neighborhoodRaw: string | null
  priceNis: number
  rooms: number | null
  areaSqm: number | null
  floor: number | null
  firstSeenAt: Date
  sourceUrl: string | null
  comparisons?: { classification: string | null; pctDiff: number }[]
}, idx: number): string {
  const loc   = [l.cityRaw, l.neighborhoodRaw].filter(Boolean).join(', ')
  const rooms  = l.rooms   ? `${l.rooms}r` : ''
  const sqm    = l.areaSqm ? `${l.areaSqm}m²` : ''
  const floor  = l.floor != null ? `fl.${l.floor}` : ''
  const meta   = [rooms, sqm, floor].filter(Boolean).join('  ')
  const days   = Math.floor((Date.now() - new Date(l.firstSeenAt).getTime()) / 86400000)
  const age    = days === 0 ? '🆕 today' : `${days}d ago`
  const cmp    = l.comparisons?.[0]
  const badge  = cmp?.classification === 'deal' ? ' 🔥Deal' : cmp?.classification === 'below_market' ? ' 📉Below' : ''
  const link   = l.sourceUrl ? `\n   🔗 <a href="${l.sourceUrl}">View on Yad2</a>` : ''
  return `${idx}. <b>${formatPrice(l.priceNis)}</b>${badge}  ${meta}\n   📍 ${loc}  •  ${age}${link}`
}

async function handleMessage(msg: { message_id: number; chat: { id: number }; text?: string }) {
  const chatId = msg.chat.id
  const text   = (msg.text ?? '').trim()
  const [cmd, ...args] = text.split(/\s+/)
  const command = cmd.toLowerCase().replace('@', '').split('@')[0]

  if (command === '/start' || command === '/help') {
    await reply(chatId, [
      '<b>Nadlan Scout Bot</b> 🏠',
      '',
      'Commands:',
      '/cities — show available cities',
      '/search &lt;city&gt; [rooms] [sale|rent] — top 5 listings',
      '/top &lt;city&gt; [sale|rent] — 5 best-value deals',
      '/stats — database summary',
      '',
      'Examples:',
      '/search ashdod 3 sale',
      '/top tel aviv rent',
      '/search ירושלים 4',
    ].join('\n'))
    return
  }

  if (command === '/cities') {
    const cities = await prisma.city.findMany({ orderBy: { name: 'asc' } })
    const lines = cities.map(c => `• ${c.name} (${c.nameHe ?? ''})`)
    await reply(chatId, `<b>Available cities (${cities.length}):</b>\n${lines.join('\n')}`)
    return
  }

  if (command === '/stats') {
    const [total, forSale, forRent, fresh] = await Promise.all([
      prisma.listing.count({ where: { isActive: true } }),
      prisma.listing.count({ where: { isActive: true, dealType: 'sale' } }),
      prisma.listing.count({ where: { isActive: true, dealType: 'rent' } }),
      prisma.listing.count({ where: { isActive: true, firstSeenAt: { gte: new Date(Date.now() - 24 * 3600_000) } } }),
    ])
    await reply(chatId, [
      '<b>Database stats</b>',
      `Total active listings: <b>${total.toLocaleString()}</b>`,
      `For sale: ${forSale.toLocaleString()}  •  For rent: ${forRent.toLocaleString()}`,
      `New in last 24h: <b>${fresh}</b> 🆕`,
    ].join('\n'))
    return
  }

  if (command === '/search' || command === '/top') {
    if (!args.length) {
      await reply(chatId, `Usage: ${command} &lt;city&gt; [rooms] [sale|rent]\nExample: ${command} ashdod 3 sale`)
      return
    }

    // Parse args: find deal type and rooms number, rest is city name
    let dealType = 'sale'
    let rooms: number | undefined
    const cityParts: string[] = []

    for (const a of args) {
      if (a === 'sale' || a === 'rent') { dealType = a; continue }
      const n = Number(a)
      if (!isNaN(n) && n >= 1 && n <= 10) { rooms = n; continue }
      cityParts.push(a)
    }

    const cityQuery = cityParts.join(' ').toLowerCase()
    const cityId = CITY_ALIASES[cityQuery]

    if (!cityId) {
      await reply(chatId, `Unknown city: <b>${cityParts.join(' ')}</b>\nUse /cities to see all options.`)
      return
    }

    const where: Record<string, unknown> = { isActive: true, dealType, cityId }
    if (rooms) where.rooms = rooms

    const orderBy = command === '/top'
      ? [{ comparisons: { _count: 'desc' as const } }, { firstSeenAt: 'desc' as const }]
      : [{ firstSeenAt: 'desc' as const }]

    const listings = await prisma.listing.findMany({
      where,
      include: { comparisons: { orderBy: { computedAt: 'desc' }, take: 1 } },
      orderBy: command === '/top' ? { priceNis: 'asc' } : { firstSeenAt: 'desc' },
      take: 5,
    })

    if (!listings.length) {
      await reply(chatId, `No active listings found for <b>${cityParts.join(' ')}</b>${rooms ? ` ${rooms}r` : ''} (${dealType}).\nTry /search without room filter, or scan via the web app first.`)
      return
    }

    const dealLabel = dealType === 'sale' ? 'For Sale' : 'For Rent'
    const roomLabel = rooms ? ` · ${rooms} rooms` : ''
    const header = command === '/top'
      ? `🏆 <b>Best value — ${cityParts.join(' ')} ${dealLabel}${roomLabel}</b>`
      : `🔍 <b>Latest — ${cityParts.join(' ')} ${dealLabel}${roomLabel}</b>`

    const lines = listings.map((l, i) => formatListing({
      ...l,
      comparisons: l.comparisons.map(c => ({ classification: c.classification, pctDiff: Number(c.pctDiff) })),
    }, i + 1))

    await reply(chatId, header + '\n\n' + lines.join('\n\n'))
    return
  }

  // Ignore non-commands (group messages etc.)
  if (text.startsWith('/')) {
    await reply(chatId, 'Unknown command. Use /help to see available commands.')
  }
}

export async function telegramBotRoute(app: FastifyInstance) {
  // POST /telegram/webhook — called by Telegram servers
  app.post('/telegram/webhook', async (req, res) => {
    try {
      const body = req.body as { message?: Parameters<typeof handleMessage>[0] }
      if (body?.message) {
        handleMessage(body.message).catch(err => console.error('[telegram-bot] handler error:', err))
      }
    } catch (err) {
      console.error('[telegram-bot] webhook error:', err)
    }
    res.send({ ok: true })
  })
}
