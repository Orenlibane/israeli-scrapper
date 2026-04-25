/**
 * Telegram alert service.
 * Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in environment.
 * TELEGRAM_CHAT_ID can be a single chat ID or comma-separated list.
 */

import type { PrismaClient } from '@prisma/client'

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const CHAT_IDS  = (process.env.TELEGRAM_CHAT_ID ?? '').split(',').map(s => s.trim()).filter(Boolean)

export function telegramEnabled(): boolean {
  return Boolean(BOT_TOKEN && CHAT_IDS.length > 0)
}

async function sendMessage(chatId: string, text: string): Promise<void> {
  if (!BOT_TOKEN) return
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
  }).catch(err => console.error('[telegram] sendMessage failed:', err))
}

async function broadcast(text: string): Promise<void> {
  await Promise.all(CHAT_IDS.map(id => sendMessage(id, text)))
}

export async function notifyNewListing(l: {
  id: string
  cityRaw: string | null
  neighborhoodRaw: string | null
  priceNis: number
  rooms: number | null
  areaSqm: number | null
  floor: number | null
  dealType: string
  sourceUrl: string | null
}): Promise<void> {
  if (!telegramEnabled()) return

  const price   = l.priceNis.toLocaleString('he-IL')
  const rooms   = l.rooms   ? `${l.rooms}r` : '?r'
  const sqm     = l.areaSqm ? `${l.areaSqm}m²` : ''
  const floor   = l.floor   != null ? ` fl.${l.floor}` : ''
  const type    = l.dealType === 'sale' ? '🏠 For Sale' : '🔑 For Rent'
  const loc     = [l.cityRaw, l.neighborhoodRaw].filter(Boolean).join(', ')
  const link    = l.sourceUrl ? `\n🔗 <a href="${l.sourceUrl}">View on Yad2</a>` : ''

  const text = `${type} — New listing\n📍 ${loc}\n💰 ₪${price}  ${rooms}  ${sqm}${floor}${link}`
  await broadcast(text)
}

export async function notifyTopDeals(prisma: PrismaClient): Promise<void> {
  if (!telegramEnabled()) return

  const deals = await prisma.listingComparison.findMany({
    where: {
      classification: { in: ['deal', 'below_market'] },
      pctDiff: { gte: -60 },   // exclude likely data errors
      listing: { isActive: true },
    },
    include: {
      listing: {
        select: {
          priceNis: true,
          rooms: true,
          areaSqm: true,
          floor: true,
          cityRaw: true,
          neighborhoodRaw: true,
          dealType: true,
          sourceUrl: true,
          firstSeenAt: true,
        },
      },
    },
    orderBy: { pctDiff: 'asc' },   // most discounted first
    take: 8,
  })

  if (!deals.length) return

  function fmt(p: number): string {
    if (p >= 1_000_000) return '₪' + (p / 1_000_000).toFixed(2).replace(/\.?0+$/, '') + 'M'
    return '₪' + Math.round(p / 1_000) + 'K'
  }

  const lines = deals.map((d, i) => {
    const l = d.listing
    const loc   = [l.cityRaw, l.neighborhoodRaw].filter(Boolean).join(', ')
    const rooms = l.rooms   ? `${l.rooms}r` : ''
    const sqm   = l.areaSqm ? `${Math.round(l.areaSqm)}m²` : ''
    const fl    = l.floor != null ? `fl.${l.floor}` : ''
    const meta  = [rooms, sqm, fl].filter(Boolean).join('  ')
    const pct   = d.pctDiff.toFixed(1)
    const days  = Math.floor((Date.now() - new Date(l.firstSeenAt).getTime()) / 86_400_000)
    const age   = days === 0 ? '🆕' : `${days}d`
    const badge = d.pctDiff <= -15 ? '🔥' : '📉'
    const warn  = d.pctDiff < -35 ? ' ⚠️' : ''
    const link  = l.sourceUrl ? `\n   🔗 <a href="${l.sourceUrl}">Yad2</a>` : ''
    return `${i + 1}. ${badge} <b>${fmt(l.priceNis)}</b> (${pct}%)${warn}  ${meta}\n   📍 ${loc} · ${age}${link}`
  })

  const saleCount = deals.filter(d => d.listing.dealType === 'sale').length
  const rentCount = deals.length - saleCount
  const parts = [saleCount && `${saleCount} sale`, rentCount && `${rentCount} rent`].filter(Boolean).join(' · ')
  const header = `🏆 <b>Top deals right now</b>  (${parts})\n`

  await broadcast(header + '\n' + lines.join('\n\n'))
}

// ─── Single-chat send (used by profile alerts) ────────────────────────────────

export async function sendToChat(chatId: string, text: string): Promise<void> {
  await sendMessage(chatId, text)
}

// ─── Profile-based deal alerts ────────────────────────────────────────────────

interface CityEntry { id: number; he: string; en: string }

const CITY_MAP: CityEntry[] = [
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

function cityEnById(id: number): string {
  return CITY_MAP.find(c => c.id === id)?.en ?? String(id)
}

function fmtPrice(p: number): string {
  if (p >= 1_000_000) return '₪' + (p / 1_000_000).toFixed(2).replace(/\.?0+$/, '') + 'M'
  return '₪' + Math.round(p / 1_000) + 'K'
}

export async function notifyProfileDeals(prisma: PrismaClient): Promise<void> {
  // Load all active profiles whose last alert is due
  const profiles = await prisma.searchProfile.findMany({
    where: {
      isActive: true,
      user: { status: 'active' },
      OR: [
        { lastSentAt: null },
        // lastSentAt < now - scanIntervalHours
        // We filter in JS below since Prisma doesn't support column arithmetic in where
      ],
    },
    include: { user: { select: { telegramChatId: true } } },
  })

  const now = Date.now()

  for (const profile of profiles) {
    // Check interval threshold in JS
    if (profile.lastSentAt != null) {
      const ageMs = now - new Date(profile.lastSentAt).getTime()
      const thresholdMs = profile.scanIntervalHours * 3_600_000
      if (ageMs < thresholdMs) continue
    }

    // Build listing query filters
    const listingWhere: Record<string, unknown> = {
      isActive: true,
      dealType: profile.dealType,
    }
    if (profile.cityIds.length > 0) listingWhere.cityId = { in: profile.cityIds }
    if (profile.minRooms != null)   listingWhere.rooms  = { gte: profile.minRooms }
    if (profile.maxPrice != null)   listingWhere.priceNis = { lte: profile.maxPrice }

    const deals = await prisma.listingComparison.findMany({
      where: {
        classification: { in: ['deal', 'below_market'] },
        pctDiff: { gte: -60 },
        listing: listingWhere,
      },
      include: {
        listing: {
          select: {
            id: true,
            priceNis: true,
            pricePerSqm: true,
            rooms: true,
            areaSqm: true,
            floor: true,
            cityRaw: true,
            neighborhoodRaw: true,
            dealType: true,
            sourceUrl: true,
            firstSeenAt: true,
          },
        },
      },
      orderBy: { pctDiff: 'asc' },
      take: 8,
    })

    if (!deals.length) continue

    // Get already-sent listing IDs for this profile
    const sentAlerts = await prisma.alert.findMany({
      where: { profileId: profile.id },
      select: { listingId: true },
    })
    const sentIds = new Set(sentAlerts.map(a => a.listingId).filter(Boolean) as string[])

    const newListings = deals.filter(d => !sentIds.has(d.listing.id))
    if (newListings.length === 0) continue  // nothing new to send

    // Build message
    const cityLabel = profile.cityIds[0] ? cityEnById(profile.cityIds[0]) : 'Israel'
    const dealLabel = profile.dealType === 'rent' ? 'Rent' : 'Sale'
    const typeEmoji = profile.dealType === 'rent' ? '🔑' : '🏠'

    const header = [
      `${typeEmoji} <b>Top Deals — ${cityLabel} ${dealLabel}</b>`,
      `<i>${newListings.length} new since last alert</i>`,
    ].join('\n')

    const colHeader = `<code> #  ${' Price   '.padEnd(8)} Rm  ₪/m²   Disc  </code>`

    const rows = deals.map((d, i) => {
      const l      = d.listing
      const isNew  = !sentIds.has(l.id)
      const price  = fmtPrice(l.priceNis)
      const rooms  = l.rooms    ? `${l.rooms}r` : '?r'
      const ppm2   = l.pricePerSqm ? `${Math.round(l.pricePerSqm / 1000)}K` : '—'
      const pct    = d.pctDiff.toFixed(0)
      const badge  = d.pctDiff <= -15 ? '🔥' : '📉'
      const days   = Math.floor((Date.now() - new Date(l.firstSeenAt).getTime()) / 86_400_000)
      const age    = days === 0 ? 'today' : `${days}d`
      const loc    = [l.cityRaw, l.neighborhoodRaw].filter(Boolean).join(' · ')
      const link   = l.sourceUrl ? ` <a href="${l.sourceUrl}">→</a>` : ''
      const newTag = isNew ? ' 🆕 NEW' : ''

      const num    = String(i + 1).padStart(2)
      const row    = `<code>${num}  ${price.padEnd(8)} ${rooms.padEnd(4)} ${ppm2.padEnd(6)} ${pct}%${badge}</code>${newTag}`
      const meta   = `   📍 ${loc} · ${age}${link}`
      return row + '\n' + meta
    })

    const text = [header, '', colHeader, ...rows].join('\n')

    await sendToChat(profile.user.telegramChatId, text)

    // Save Alert rows for newly shown listings
    if (newListings.length > 0) {
      await prisma.alert.createMany({
        data: newListings.map(d => ({
          userId:        profile.userId,
          profileId:     profile.id,
          listingId:     d.listing.id,
          alertType:     'opportunity',
          deliveryStatus: 'sent',
        })),
        skipDuplicates: true,
      })
    }

    // Update lastSentAt
    await prisma.searchProfile.update({
      where: { id: profile.id },
      data:  { lastSentAt: new Date() },
    })
  }
}

export async function notifyPriceDrop(l: {
  id: string
  cityRaw: string | null
  neighborhoodRaw: string | null
  oldPrice: number
  newPrice: number
  rooms: number | null
  areaSqm: number | null
  dealType: string
  sourceUrl: string | null
}): Promise<void> {
  if (!telegramEnabled()) return

  const drop    = l.oldPrice - l.newPrice
  const pct     = ((drop / l.oldPrice) * 100).toFixed(1)
  const loc     = [l.cityRaw, l.neighborhoodRaw].filter(Boolean).join(', ')
  const type    = l.dealType === 'sale' ? '🏠' : '🔑'
  const link    = l.sourceUrl ? `\n🔗 <a href="${l.sourceUrl}">View on Yad2</a>` : ''

  const text = `${type} Price drop ${pct}% — ₪${l.oldPrice.toLocaleString()} → ₪${l.newPrice.toLocaleString()}\n📍 ${loc}  ${l.rooms ?? '?'}r  ${l.areaSqm ? l.areaSqm + 'm²' : ''}${link}`
  await broadcast(text)
}
