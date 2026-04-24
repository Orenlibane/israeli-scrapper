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
