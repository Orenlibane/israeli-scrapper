/**
 * Telegram bot webhook handler with stateful onboarding.
 * Register webhook once with:
 *   curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://api-production.up.railway.app/telegram/webhook"
 */

import type { FastifyInstance } from 'fastify'
import { prisma } from '../index'

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!

// ─── City catalogue ───────────────────────────────────────────────────────────

interface CityEntry { id: number; he: string; en: string }

const CITIES: CityEntry[] = [
  { id: 5000, he: 'תל אביב',      en: 'Tel Aviv' },
  { id: 3000, he: 'ירושלים',      en: 'Jerusalem' },
  { id: 4000, he: 'חיפה',         en: 'Haifa' },
  { id: 8300, he: 'ראשון לציון',  en: 'Rishon LeZion' },
  { id: 7900, he: 'פתח תקווה',    en: 'Petah Tikva' },
  { id: 70,   he: 'אשדוד',        en: 'Ashdod' },
  { id: 7400, he: 'נתניה',        en: 'Netanya' },
  { id: 9000, he: 'באר שבע',      en: 'Beer Sheva' },
  { id: 6600, he: 'חולון',        en: 'Holon' },
  { id: 6200, he: 'בני ברק',      en: 'Bnei Brak' },
  { id: 8600, he: 'רמת גן',       en: 'Ramat Gan' },
  { id: 6400, he: 'הרצליה',       en: 'Herzliya' },
  { id: 6900, he: 'כפר סבא',      en: 'Kfar Saba' },
  { id: 8400, he: 'רחובות',       en: 'Rehovot' },
  { id: 1200, he: 'מודיעין',      en: "Modi'in" },
  { id: 8700, he: 'רעננה',        en: "Ra'anana" },
  { id: 650,  he: 'אשקלון',       en: 'Ashkelon' },
  { id: 6300, he: 'בת ים',        en: 'Bat Yam' },
]

const CITY_ALIASES: Record<string, number> = {
  'tel aviv': 5000, 'תל אביב': 5000, 'ta': 5000,
  'jerusalem': 3000, 'ירושלים': 3000, 'jlm': 3000,
  'haifa': 4000, 'חיפה': 4000,
  'rishon': 8300, 'rishon lezion': 8300, 'ראשון לציון': 8300,
  'petah tikva': 7900, 'פתח תקווה': 7900,
  'ashdod': 70, 'אשדוד': 70,
  'netanya': 7400, 'נתניה': 7400,
  'beer sheva': 9000, "be'er sheva": 9000, 'באר שבע': 9000,
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

function cityById(id: number): CityEntry | undefined {
  return CITIES.find(c => c.id === id)
}

// ─── State machine ────────────────────────────────────────────────────────────

type Step = 'city' | 'dealtype' | 'rooms' | 'maxprice' | 'interval' | 'confirm'

interface ConvoState {
  step: Step
  cityId?: number
  cityLabel?: string
  dealType?: string
  minRooms?: number
  maxPrice?: number
  scanIntervalHours?: number
  expiresAt: number
}

const STATE_TTL_MS = 10 * 60 * 1000  // 10 minutes
const conversations = new Map<number, ConvoState>()

function getState(chatId: number): ConvoState | undefined {
  const s = conversations.get(chatId)
  if (!s) return undefined
  if (Date.now() > s.expiresAt) { conversations.delete(chatId); return undefined }
  return s
}

function setState(chatId: number, state: Omit<ConvoState, 'expiresAt'>) {
  conversations.set(chatId, { ...state, expiresAt: Date.now() + STATE_TTL_MS })
}

function clearState(chatId: number) {
  conversations.delete(chatId)
}

// ─── Telegram API helpers ─────────────────────────────────────────────────────

type InlineKeyboard = { inline_keyboard: { text: string; callback_data: string }[][] }

async function sendMsg(chatId: number, text: string, keyboard?: InlineKeyboard): Promise<void> {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  }
  if (keyboard) body.reply_markup = keyboard
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(err => console.error('[telegram-bot] sendMsg failed:', err))
}

async function answerCb(cbId: string, text?: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: cbId, text: text ?? '' }),
  }).catch(err => console.error('[telegram-bot] answerCb failed:', err))
}

async function editMsg(chatId: number, msgId: number, text: string, keyboard?: InlineKeyboard): Promise<void> {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    message_id: msgId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  }
  if (keyboard) body.reply_markup = keyboard
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(err => console.error('[telegram-bot] editMsg failed:', err))
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

function formatPrice(p: number): string {
  if (p >= 1_000_000) return '₪' + (p / 1_000_000).toFixed(2).replace(/\.?0+$/, '') + 'M'
  if (p >= 1_000)     return '₪' + Math.round(p / 1_000) + 'K'
  return '₪' + p
}

function pad(s: string, len: number): string {
  return s.length >= len ? s : s + ' '.repeat(len - s.length)
}

function formatListingTable(l: {
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
  const rooms  = l.rooms    ? `${l.rooms}r`        : '?r'
  const sqm    = l.areaSqm  ? `${l.areaSqm}m²`     : ''
  const floor  = l.floor != null ? `fl.${l.floor}` : ''
  const days   = Math.floor((Date.now() - new Date(l.firstSeenAt).getTime()) / 86_400_000)
  const age    = days === 0 ? 'today' : `${days}d`
  const cmp    = l.comparisons?.[0]
  const badge  = cmp?.classification === 'deal' ? ' 🔥' : cmp?.classification === 'below_market' ? ' 📉' : ''

  const numPart = `${String(idx).padStart(2)} ${pad(formatPrice(l.priceNis), 7)} ${pad(rooms, 4)} ${pad(sqm, 5)} ${floor ? pad(floor, 5) : '     '} ${age}`
  const loc = [l.cityRaw, l.neighborhoodRaw].filter(Boolean).join(', ')
  const link = l.sourceUrl ? ` 🔗 <a href="${l.sourceUrl}">View</a>` : ''

  return `<code>${numPart}${badge}</code>\n   📍 ${loc}${link}`
}

// ─── Onboarding keyboards ─────────────────────────────────────────────────────

function cityKeyboard(): InlineKeyboard {
  const rows: { text: string; callback_data: string }[][] = []
  for (let i = 0; i < CITIES.length; i += 3) {
    rows.push(
      CITIES.slice(i, i + 3).map(c => ({
        text: c.en,
        callback_data: `ob:city:${c.id}:${c.en}`,
      }))
    )
  }
  return { inline_keyboard: rows }
}

function dealTypeKeyboard(): InlineKeyboard {
  return {
    inline_keyboard: [[
      { text: '🏠 For Sale', callback_data: 'ob:deal:sale' },
      { text: '🔑 For Rent', callback_data: 'ob:deal:rent' },
    ]],
  }
}

function roomsKeyboard(): InlineKeyboard {
  const roomOptions = ['1', '1.5', '2', '2.5', '3', '3.5', '4', '4.5', '5+']
  const rows: { text: string; callback_data: string }[][] = []
  for (let i = 0; i < roomOptions.length; i += 3) {
    rows.push(
      roomOptions.slice(i, i + 3).map(r => ({
        text: r,
        callback_data: `ob:rooms:${r}`,
      }))
    )
  }
  rows.push([{ text: '⏭ Skip', callback_data: 'ob:rooms:skip' }])
  return { inline_keyboard: rows }
}

function skipKeyboard(cbData: string): InlineKeyboard {
  return { inline_keyboard: [[{ text: '⏭ Skip', callback_data: cbData }]] }
}

function intervalKeyboard(): InlineKeyboard {
  return {
    inline_keyboard: [
      [
        { text: 'Every hour',  callback_data: 'ob:interval:1' },
        { text: 'Every 2h',   callback_data: 'ob:interval:2' },
        { text: 'Every 4h',   callback_data: 'ob:interval:4' },
      ],
      [
        { text: 'Every 8h',   callback_data: 'ob:interval:8' },
        { text: 'Once a day', callback_data: 'ob:interval:24' },
      ],
    ],
  }
}

function confirmKeyboard(): InlineKeyboard {
  return {
    inline_keyboard: [[
      { text: '✅ Create profile', callback_data: 'ob:confirm:yes' },
      { text: '❌ Cancel',         callback_data: 'ob:confirm:no' },
    ]],
  }
}

function buildSummary(s: ConvoState): string {
  const city     = s.cityLabel ?? '?'
  const deal     = s.dealType === 'rent' ? '🔑 Rent' : '🏠 Sale'
  const rooms    = s.minRooms != null ? `${s.minRooms}+` : 'Any'
  const price    = s.maxPrice != null ? formatPrice(s.maxPrice) : 'Any'
  const interval = s.scanIntervalHours === 24 ? 'Once a day'
    : s.scanIntervalHours === 1 ? 'Every hour'
    : `Every ${s.scanIntervalHours}h`
  return [
    '<b>Profile summary</b>',
    `📍 City: <b>${city}</b>`,
    `🏷 Type: <b>${deal}</b>`,
    `🛏 Min rooms: <b>${rooms}</b>`,
    `💰 Max price: <b>${price}</b>`,
    `⏱ Alert interval: <b>${interval}</b>`,
  ].join('\n')
}

// ─── DB helper ────────────────────────────────────────────────────────────────

async function getOrCreateUser(chatId: number, username?: string) {
  return prisma.user.upsert({
    where:  { telegramChatId: String(chatId) },
    update: username ? { telegramUsername: username } : {},
    create: {
      telegramChatId:   String(chatId),
      telegramUsername: username,
      status:           'active',
    },
  })
}

// ─── Onboarding flow ──────────────────────────────────────────────────────────

async function startOnboarding(chatId: number) {
  setState(chatId, { step: 'city' })
  await sendMsg(
    chatId,
    '🏙 <b>Step 1 / 6 — Choose a city</b>\n\nWhich city do you want to watch?',
    cityKeyboard(),
  )
}

// ─── Command handlers ─────────────────────────────────────────────────────────

async function handleStart(chatId: number, username?: string) {
  const existing = await prisma.user.findUnique({
    where: { telegramChatId: String(chatId) },
    include: { profiles: { where: { isActive: true } } },
  })
  if (!existing || existing.profiles.length === 0) {
    await sendMsg(chatId, [
      '👋 <b>Welcome to Nadlan Scout!</b>',
      '',
      "I'll alert you when new deals appear in the Israeli real estate market.",
      "Let's set up your first search profile.",
    ].join('\n'))
    await startOnboarding(chatId)
  } else {
    await sendMsg(chatId, [
      `👋 <b>Welcome back!</b>`,
      `You have <b>${existing.profiles.length}</b> active profile(s).`,
      '',
      'Use /myprofiles to manage them or /newprofile to add another.',
      'Use /help to see all commands.',
    ].join('\n'))
  }
  if (!existing) await getOrCreateUser(chatId, username)
}

async function handleNewProfile(chatId: number) {
  await startOnboarding(chatId)
}

async function handleMyProfiles(chatId: number) {
  const user = await prisma.user.findUnique({
    where: { telegramChatId: String(chatId) },
    include: { profiles: { orderBy: { createdAt: 'asc' } } },
  })
  if (!user || user.profiles.length === 0) {
    await sendMsg(chatId, "You have no profiles yet. Use /newprofile to create one.")
    return
  }
  for (const p of user.profiles) {
    const statusEmoji = p.isActive ? '✅' : '⏸'
    const city    = p.cityIds[0] ? (cityById(p.cityIds[0])?.en ?? String(p.cityIds[0])) : '?'
    const deal    = p.dealType === 'rent' ? '🔑 Rent' : '🏠 Sale'
    const rooms   = p.minRooms != null ? `${p.minRooms}+` : 'Any'
    const price   = p.maxPrice != null ? formatPrice(p.maxPrice) : 'Any'
    const interval = p.scanIntervalHours === 24 ? 'Daily'
      : p.scanIntervalHours === 1 ? 'Hourly'
      : `Every ${p.scanIntervalHours}h`
    const card = [
      `${statusEmoji} <b>${p.name}</b>`,
      `📍 ${city}  🏷 ${deal}  🛏 ${rooms}  💰 max ${price}`,
      `⏱ ${interval}`,
    ].join('\n')
    const keyboard: InlineKeyboard = {
      inline_keyboard: [
        p.isActive
          ? [{ text: '⏸ Pause', callback_data: `profile:pause:${p.id}` }]
          : [{ text: '▶️ Resume', callback_data: `profile:resume:${p.id}` }],
        [{ text: '🗑 Delete', callback_data: `profile:delete:${p.id}` }],
      ],
    }
    await sendMsg(chatId, card, keyboard)
  }
}

async function handleStop(chatId: number) {
  const user = await prisma.user.findUnique({ where: { telegramChatId: String(chatId) } })
  if (!user) { await sendMsg(chatId, 'No account found. Use /start first.'); return }
  await prisma.$transaction([
    prisma.searchProfile.updateMany({ where: { userId: user.id }, data: { isActive: false } }),
    prisma.user.update({ where: { id: user.id }, data: { status: 'stopped' } }),
  ])
  await sendMsg(chatId, '⏸ All profiles paused. Use /myprofiles to re-enable them or /start to begin again.')
}

async function handleHelp(chatId: number) {
  await sendMsg(chatId, [
    '<b>Nadlan Scout Bot 🏠</b>',
    '',
    '<b>Alert management</b>',
    '/start — welcome &amp; quick setup',
    '/newprofile — create a new search profile',
    '/myprofiles — view, pause or delete profiles',
    '/stop — pause all alerts',
    '',
    '<b>Search commands</b>',
    '/cities — list all supported cities',
    '/search &lt;city&gt; [rooms] [sale|rent] — latest 5 listings',
    '/top &lt;city&gt; [sale|rent] — 5 best-value deals',
    '/stats — database summary',
    '',
    '<b>Examples</b>',
    '/search ashdod 3 sale',
    '/top tel aviv rent',
    '/search ירושלים 4',
  ].join('\n'))
}

async function handleCities(chatId: number) {
  const lines = CITIES.map(c => `• ${c.en} (${c.he})`)
  await sendMsg(chatId, `<b>Available cities (${CITIES.length}):</b>\n${lines.join('\n')}`)
}

async function handleStats(chatId: number) {
  const [total, forSale, forRent, fresh, withComp] = await Promise.all([
    prisma.listing.count({ where: { isActive: true } }),
    prisma.listing.count({ where: { isActive: true, dealType: 'sale' } }),
    prisma.listing.count({ where: { isActive: true, dealType: 'rent' } }),
    prisma.listing.count({ where: { isActive: true, firstSeenAt: { gte: new Date(Date.now() - 24 * 3600_000) } } }),
    prisma.listingComparison.count({ where: { listing: { isActive: true } } }),
  ])

  function fmtStat(label: string, value: number): string {
    return `<code>${label.padEnd(18)} ${value.toLocaleString().padStart(7)}</code>`
  }

  await sendMsg(chatId, [
    '📊 <b>Database stats</b>',
    fmtStat('Total active', total),
    fmtStat('For sale', forSale),
    fmtStat('For rent', forRent),
    fmtStat('New (24h)', fresh),
    fmtStat('With comparison', withComp),
  ].join('\n'))
}

async function handleSearch(chatId: number, args: string[], command: '/search' | '/top') {
  if (!args.length) {
    await sendMsg(chatId, `Usage: ${command} &lt;city&gt; [rooms] [sale|rent]\nExample: ${command} ashdod 3 sale`)
    return
  }

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
  const cityId    = CITY_ALIASES[cityQuery]

  if (!cityId) {
    await sendMsg(chatId, `Unknown city: <b>${cityParts.join(' ')}</b>\nUse /cities to see all options.`)
    return
  }

  const where: Record<string, unknown> = { isActive: true, dealType, cityId }
  if (rooms) where.rooms = rooms

  const listings = await prisma.listing.findMany({
    where,
    include: { comparisons: { orderBy: { computedAt: 'desc' }, take: 1 } },
    orderBy: command === '/top' ? { priceNis: 'asc' } : { firstSeenAt: 'desc' },
    take: 5,
  })

  if (!listings.length) {
    await sendMsg(chatId, `No active listings found for <b>${cityParts.join(' ')}</b>${rooms ? ` ${rooms}r` : ''} (${dealType}).\nTry without room filter, or wait for the next scan.`)
    return
  }

  const dealLabel = dealType === 'sale' ? 'For Sale' : 'For Rent'
  const roomLabel = rooms ? ` · ${rooms} rooms` : ''
  const header    = command === '/top'
    ? `🏆 <b>Best value — ${cityParts.join(' ')} ${dealLabel}${roomLabel}</b>`
    : `🔍 <b>Latest — ${cityParts.join(' ')} ${dealLabel}${roomLabel}</b>`

  const lines = listings.map((l, i) => formatListingTable({
    ...l,
    comparisons: l.comparisons.map(c => ({ classification: c.classification, pctDiff: Number(c.pctDiff) })),
  }, i + 1))

  await sendMsg(chatId, header + '\n\n' + lines.join('\n\n'))
}

// ─── Callback query handler ───────────────────────────────────────────────────

async function handleCallbackQuery(cb: {
  id: string
  from: { id: number; username?: string }
  message?: { message_id: number; chat: { id: number } }
  data?: string
}) {
  const cbId   = cb.id
  const chatId = cb.message?.chat.id ?? cb.from.id
  const msgId  = cb.message?.message_id
  const data   = cb.data ?? ''

  // ── Profile management callbacks ─────────────────────────────────────────
  if (data.startsWith('profile:')) {
    const [, action, profileId] = data.split(':')
    if (!profileId) { await answerCb(cbId, 'Invalid action'); return }

    if (action === 'pause') {
      await prisma.searchProfile.update({ where: { id: profileId }, data: { isActive: false } })
      await answerCb(cbId, '⏸ Profile paused')
      if (msgId) await editMsg(chatId, msgId, '⏸ Profile paused.')
    } else if (action === 'resume') {
      await prisma.searchProfile.update({ where: { id: profileId }, data: { isActive: true } })
      await answerCb(cbId, '▶️ Profile resumed')
      if (msgId) await editMsg(chatId, msgId, '▶️ Profile resumed.')
    } else if (action === 'delete') {
      await prisma.searchProfile.delete({ where: { id: profileId } })
      await answerCb(cbId, '🗑 Profile deleted')
      if (msgId) await editMsg(chatId, msgId, '🗑 Profile deleted.')
    }
    return
  }

  // ── Onboarding callbacks ──────────────────────────────────────────────────
  if (!data.startsWith('ob:')) { await answerCb(cbId); return }

  const state = getState(chatId)
  if (!state) {
    await answerCb(cbId, 'Session expired. Use /newprofile to start again.')
    return
  }

  // ob:city:<id>:<label>
  if (data.startsWith('ob:city:')) {
    const parts = data.split(':')
    const id    = Number(parts[2])
    const label = parts.slice(3).join(':')
    setState(chatId, { ...state, step: 'dealtype', cityId: id, cityLabel: label })
    await answerCb(cbId, `📍 ${label} selected`)
    if (msgId) {
      await editMsg(chatId, msgId,
        '🏷 <b>Step 2 / 6 — Deal type</b>\n\nAre you looking to buy or rent?',
        dealTypeKeyboard(),
      )
    }
    return
  }

  // ob:deal:<sale|rent>
  if (data.startsWith('ob:deal:')) {
    const deal = data.split(':')[2]
    setState(chatId, { ...state, step: 'rooms', dealType: deal })
    await answerCb(cbId)
    if (msgId) {
      await editMsg(chatId, msgId,
        '🛏 <b>Step 3 / 6 — Minimum rooms</b>\n\nSelect minimum number of rooms (or skip):',
        roomsKeyboard(),
      )
    }
    return
  }

  // ob:rooms:<value|skip>
  if (data.startsWith('ob:rooms:')) {
    const val = data.split(':')[2]
    const minRooms = val === 'skip' ? undefined : (val === '5+' ? 5 : Number(val))
    setState(chatId, { ...state, step: 'maxprice', minRooms })
    await answerCb(cbId)
    if (msgId) {
      await editMsg(chatId, msgId,
        '💰 <b>Step 4 / 6 — Max price</b>\n\nType your max price (e.g. <code>2000000</code>) or skip:',
        skipKeyboard('ob:price:skip'),
      )
    }
    return
  }

  // ob:price:skip
  if (data === 'ob:price:skip') {
    setState(chatId, { ...state, step: 'interval', maxPrice: undefined })
    await answerCb(cbId)
    if (msgId) {
      await editMsg(chatId, msgId,
        '⏱ <b>Step 5 / 6 — Alert frequency</b>\n\nHow often should I check for new deals?',
        intervalKeyboard(),
      )
    }
    return
  }

  // ob:interval:<hours>
  if (data.startsWith('ob:interval:')) {
    const hours = Number(data.split(':')[2])
    const next = { ...state, step: 'confirm' as const, scanIntervalHours: hours }
    setState(chatId, next)
    await answerCb(cbId)
    if (msgId) {
      await editMsg(chatId, msgId,
        buildSummary(next) + '\n\nLooks good? Confirm to create the profile.',
        confirmKeyboard(),
      )
    }
    return
  }

  // ob:confirm:<yes|no>
  if (data.startsWith('ob:confirm:')) {
    const choice = data.split(':')[2]
    if (choice === 'no') {
      clearState(chatId)
      await answerCb(cbId, '❌ Cancelled')
      if (msgId) await editMsg(chatId, msgId, '❌ Profile creation cancelled.')
      return
    }

    // Create the profile
    const user = await getOrCreateUser(chatId, cb.from.username)
    const cityLabel = state.cityLabel ?? 'Custom'
    const deal  = state.dealType ?? 'sale'
    const rooms = state.minRooms
    const price = state.maxPrice
    const hours = state.scanIntervalHours ?? 4
    const name  = `${cityLabel} — ${deal === 'rent' ? 'Rent' : 'Sale'}${rooms != null ? ` ${rooms}r+` : ''}`

    await prisma.searchProfile.create({
      data: {
        userId:           user.id,
        name,
        cityIds:          state.cityId ? [state.cityId] : [],
        dealType:         deal,
        minRooms:         rooms,
        maxPrice:         price,
        scanIntervalHours: hours,
        isActive:         true,
      },
    })

    clearState(chatId)
    await answerCb(cbId, '✅ Profile created!')
    if (msgId) {
      await editMsg(chatId, msgId,
        `✅ <b>Profile created!</b>\n\n${buildSummary({ ...state, step: 'confirm', scanIntervalHours: hours })}\n\nI'll alert you when matching deals appear. Use /myprofiles to manage it.`,
      )
    }
    return
  }

  await answerCb(cbId)
}

// ─── Message handler ──────────────────────────────────────────────────────────

async function handleMessage(msg: {
  message_id: number
  chat: { id: number }
  from?: { id: number; username?: string }
  text?: string
}) {
  const chatId   = msg.chat.id
  const username = msg.from?.username
  const text     = (msg.text ?? '').trim()

  // Check if we're waiting for a price input
  const state = getState(chatId)
  if (state?.step === 'maxprice' && !text.startsWith('/')) {
    const price = parseInt(text.replace(/[,\s]/g, ''), 10)
    if (!isNaN(price) && price > 0) {
      setState(chatId, { ...state, step: 'interval', maxPrice: price })
      await sendMsg(chatId,
        '⏱ <b>Step 5 / 6 — Alert frequency</b>\n\nHow often should I check for new deals?',
        intervalKeyboard(),
      )
    } else {
      await sendMsg(chatId, 'Please enter a valid number (e.g. <code>2000000</code>) or press Skip.')
    }
    return
  }

  if (!text) return
  const [cmd, ...args] = text.split(/\s+/)
  const command = cmd.toLowerCase().split('@')[0]

  switch (command) {
    case '/start':
      await handleStart(chatId, username)
      break
    case '/newprofile':
      await handleNewProfile(chatId)
      break
    case '/myprofiles':
      await handleMyProfiles(chatId)
      break
    case '/stop':
      await handleStop(chatId)
      break
    case '/help':
      await handleHelp(chatId)
      break
    case '/cities':
      await handleCities(chatId)
      break
    case '/stats':
      await handleStats(chatId)
      break
    case '/search':
      await handleSearch(chatId, args, '/search')
      break
    case '/top':
      await handleSearch(chatId, args, '/top')
      break
    default:
      if (text.startsWith('/')) {
        await sendMsg(chatId, 'Unknown command. Use /help to see available commands.')
      }
  }
}

// ─── Route registration ───────────────────────────────────────────────────────

export async function telegramBotRoute(app: FastifyInstance) {
  app.post('/telegram/webhook', async (req, res) => {
    try {
      const body = req.body as {
        message?: Parameters<typeof handleMessage>[0]
        callback_query?: Parameters<typeof handleCallbackQuery>[0]
      }
      if (body?.callback_query) {
        handleCallbackQuery(body.callback_query).catch(err =>
          console.error('[telegram-bot] callback handler error:', err))
      } else if (body?.message) {
        handleMessage(body.message).catch(err =>
          console.error('[telegram-bot] message handler error:', err))
      }
    } catch (err) {
      console.error('[telegram-bot] webhook error:', err)
    }
    res.send({ ok: true })
  })
}
