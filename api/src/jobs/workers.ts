import type PgBoss from 'pg-boss'
import type { PrismaClient } from '@prisma/client'
import { notifyNewListing, notifyPriceDrop } from '../services/telegram'

const SCRAPER_URL = process.env.SCRAPER_URL ?? 'http://localhost:8001'

// Hebrew city names for nadlan.gov.il geocoding — must match actual Israeli city names
const CITY_NAMES_HE: Record<number, string> = {
  70:   'אשדוד',
  650:  'אשקלון',
  1200: 'מודיעין מכבים רעות',
  3000: 'ירושלים',
  4000: 'חיפה',
  5000: 'תל אביב יפו',
  6200: 'בני ברק',
  6300: 'בת ים',
  6400: 'הרצליה',
  6600: 'חולון',
  6900: 'כפר סבא',
  7400: 'נתניה',
  7900: 'פתח תקווה',
  8300: 'ראשון לציון',
  8400: 'רחובות',
  8600: 'רמת גן',
  8700: 'רעננה',
  9000: 'באר שבע',
}

export async function registerWorkers(boss: PgBoss, prisma: PrismaClient) {
  await boss.work('scan-listings', async (jobs) => {
    const job = Array.isArray(jobs) ? jobs[0] : jobs
    const { jobId, params } = job.data as { jobId: string; params: Record<string, unknown> }

    await prisma.scanJob.update({ where: { id: jobId }, data: { status: 'running' } })

    try {
      const res = await fetch(`${SCRAPER_URL}/scrape`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(5 * 60 * 1000),
      })

      if (!res.ok) throw new Error(`Scraper error: ${res.status}`)

      const { listings } = await res.json() as { listings: ScrapedListing[] }

      const cityId = typeof params.cityId === 'number' ? params.cityId : null
      const neighborhoodId = typeof params.neighborhoodId === 'number' ? params.neighborhoodId : null

      const MAX_PRICE = 2_000_000_000  // guard against Yad2 data errors (INT4 limit ~2.1B)

      let saved = 0
      for (const l of listings) {
        if (l.price_nis > MAX_PRICE) continue
        await upsertListing(prisma, l, cityId, neighborhoodId)
        saved++
      }

      await prisma.scanJob.update({
        where: { id: jobId },
        data: { status: 'done', listingsFound: saved, finishedAt: new Date() },
      })
    } catch (err) {
      await prisma.scanJob.update({
        where: { id: jobId },
        data: { status: 'failed', error: String(err), finishedAt: new Date() },
      })
      throw err
    }
  })
}

interface ScrapedListing {
  listing_id: string
  source_site: string
  source_url: string | null
  price_nis: number
  deal_type: string
  property_type: string | null
  rooms: number | null
  area_sqm: number | null
  floor: number | null
  city: string | null
  neighborhood: string | null
  street: string | null
  lat: number | null
  lon: number | null
  poster_type: string | null
  published_at: string | null
  price_per_sqm?: number | null
}

async function upsertListing(prisma: PrismaClient, l: ScrapedListing, cityId: number | null, neighborhoodId: number | null) {
  const pricePerSqm = l.price_per_sqm ??
    (l.price_nis && l.area_sqm ? Math.round(l.price_nis / l.area_sqm) : null)

  const existing = await prisma.listing.findUnique({ where: { id: l.listing_id } })

  if (existing && existing.priceNis !== l.price_nis) {
    await prisma.listingHistory.create({
      data: {
        listingId: l.listing_id,
        field: 'priceNis',
        oldValue: String(existing.priceNis),
        newValue: String(l.price_nis),
      },
    })
    // Alert on price drop only (not price increases)
    if (l.price_nis < existing.priceNis) {
      notifyPriceDrop({
        id: l.listing_id,
        cityRaw: existing.cityRaw,
        neighborhoodRaw: existing.neighborhoodRaw,
        oldPrice: existing.priceNis,
        newPrice: l.price_nis,
        rooms: existing.rooms,
        areaSqm: existing.areaSqm,
        dealType: l.deal_type,
        sourceUrl: l.source_url,
      }).catch(() => {})
    }
  }

  const saved = await prisma.listing.upsert({
    where: { id: l.listing_id },
    create: {
      id: l.listing_id,
      source: l.source_site,
      sourceUrl: l.source_url,
      priceNis: l.price_nis,
      pricePerSqm,
      dealType: l.deal_type,
      propertyType: l.property_type,
      rooms: l.rooms,
      areaSqm: l.area_sqm,
      floor: l.floor,
      cityId,
      neighborhoodId,
      cityRaw: l.city,
      neighborhoodRaw: l.neighborhood,
      street: l.street,
      lat: l.lat,
      lon: l.lon,
      posterType: l.poster_type,
      publishedAt: l.published_at ? new Date(l.published_at) : null,
    },
    update: {
      priceNis: l.price_nis,
      pricePerSqm,
      isActive: true,
      lastSeenAt: new Date(),
    },
  })

  // Alert on genuinely new listings (just created)
  if (!existing) {
    notifyNewListing({
      id: saved.id,
      cityRaw: saved.cityRaw,
      neighborhoodRaw: saved.neighborhoodRaw,
      priceNis: saved.priceNis,
      rooms: saved.rooms,
      areaSqm: saved.areaSqm,
      floor: saved.floor,
      dealType: saved.dealType,
      sourceUrl: saved.sourceUrl,
    }).catch(() => {})
  }
}

// ── Sold transaction ingestion ─────────────────────────────────────────────

interface ScrapedSoldTx {
  listing_id: string
  price_nis: number
  price_per_sqm: number | null
  rooms: number | null
  area_sqm: number | null
  floor: number | null
  city: string | null
  city_id: number | null
  street: string | null
  published_at: string | null
  gush: number | null
  helka: number | null
}

export async function ingestSoldTransactions(boss: PgBoss, prisma: PrismaClient) {
  await boss.work('scrape-sold-transactions', async () => {
    console.log('[sold-tx] Fetching sold transactions from nadlan.gov.il…')

    const cities = Object.entries(CITY_NAMES_HE).map(([id, nameHe]) => ({
      cityId: Number(id),
      cityNameHe: nameHe,
    }))

    let res: Response
    try {
      res = await fetch(`${SCRAPER_URL}/sold-transactions-bulk`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ cities, maxPagesPerSeed: 5 }),
        signal:  AbortSignal.timeout(40 * 60 * 1000),   // 40 min — Playwright is slow
      })
    } catch (err) {
      console.error('[sold-tx] Scraper request failed:', err)
      return
    }

    if (!res.ok) {
      console.error('[sold-tx] Scraper error:', res.status, await res.text().catch(() => ''))
      return
    }

    const { transactions } = await res.json() as { transactions: ScrapedSoldTx[] }
    console.log(`[sold-tx] Received ${transactions.length} transactions — upserting…`)

    let saved = 0
    for (const tx of transactions) {
      if (!tx.price_nis || tx.price_nis < 100_000) continue   // filter data errors
      await prisma.soldTransaction.upsert({
        where:  { id: tx.listing_id },
        create: {
          id:              tx.listing_id,
          address:         tx.street ?? '',
          cityRaw:         tx.city,
          cityId:          tx.city_id,
          priceNis:        tx.price_nis,
          areaSqm:         tx.area_sqm,
          pricePerSqm:     tx.price_per_sqm,
          rooms:           tx.rooms,
          floor:           tx.floor,
          transactionDate: tx.published_at ? new Date(tx.published_at) : null,
          gush:            tx.gush,
          helka:           tx.helka,
        },
        update: {
          pricePerSqm: tx.price_per_sqm,
          cityId:      tx.city_id,
        },
      })
      saved++
    }

    console.log(`[sold-tx] Done — ${saved} transactions upserted`)
  })
}
