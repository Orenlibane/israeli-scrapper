/**
 * Market comparison engine.
 *
 * Benchmark priority for each city+dealType+room bucket:
 *   1. Sold transactions (nadlan.gov.il) — actual paid prices, last 24 months, ≥5 comparables
 *   2. Active listing median — p10-p90 trimmed, ≥5 comparables
 *
 * Sold transactions are matched to listings by cityRaw string (case-insensitive trim).
 */

import type { PrismaClient } from '@prisma/client'

const MIN_COMPARABLES      = 5
const MIN_SOLD_COMPARABLES = 5
const CHUNK_SIZE           = 500
const TWO_YEARS_MS         = 2 * 365 * 86_400_000

function sortedMedian(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid]
}

function trimmedStats(prices: number[]): { median: number; avg: number; count: number } {
  const sorted    = [...prices].sort((a, b) => a - b)
  const trimCount = Math.max(0, Math.floor(sorted.length * 0.1))
  const trimmed   = sorted.slice(trimCount, sorted.length - trimCount || undefined)
  return {
    median: sortedMedian(trimmed),
    avg:    Math.round(trimmed.reduce((a, b) => a + b, 0) / trimmed.length),
    count:  trimmed.length,
  }
}

function classify(pctDiff: number): string {
  if (pctDiff <= -15) return 'deal'
  if (pctDiff <= -5)  return 'below_market'
  if (pctDiff <= +5)  return 'at_market'
  return 'overpriced'
}

function normCity(s: string | null): string {
  return (s ?? '').trim().toLowerCase()
}

export async function computeComparisons(
  prisma: PrismaClient,
): Promise<{ processed: number; skipped: number }> {

  // ── 1. Load active listings ────────────────────────────────────────────────
  const raw = await prisma.listing.findMany({
    where: {
      isActive:     true,
      pricePerSqm:  { not: null },
      cityRaw:      { not: null },
      rooms:        { not: null },
      priceNis:     { gte: 50_000 },
    },
    select: { id: true, cityRaw: true, dealType: true, rooms: true, pricePerSqm: true },
  })

  type Row = { id: string; cityRaw: string; dealType: string; rooms: number; pricePerSqm: number }
  const listings = raw as Row[]

  // ── 2. Load recent sold transactions — match by cityRaw (no cityId needed) ─
  const cutoff = new Date(Date.now() - TWO_YEARS_MS)

  const soldRaw = await prisma.soldTransaction.findMany({
    where: {
      pricePerSqm:     { not: null, gte: 1_000 },
      rooms:           { not: null },
      cityRaw:         { not: null },
      transactionDate: { gte: cutoff },
    },
    select: { cityRaw: true, rooms: true, pricePerSqm: true },
  })

  // Build city name set from listings for fast membership check
  const listingCities = new Set(listings.map(l => normCity(l.cityRaw)))

  // Group sold transactions by normCity:sale:bucket
  const soldGroups = new Map<string, number[]>()
  for (const tx of soldRaw) {
    const city = normCity(tx.cityRaw)
    if (!listingCities.has(city) || !tx.rooms || !tx.pricePerSqm) continue
    const bucket = Math.min(5, Math.round(tx.rooms))
    const key    = `${city}::sale::${bucket}`
    if (!soldGroups.has(key)) soldGroups.set(key, [])
    soldGroups.get(key)!.push(tx.pricePerSqm)
  }

  // ── 3. Group active listings by normCity:dealType:bucket ──────────────────
  const groups = new Map<string, Row[]>()
  for (const l of listings) {
    const bucket = Math.min(5, Math.round(l.rooms))
    const key    = `${normCity(l.cityRaw)}::${l.dealType}::${bucket}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(l)
  }

  const toInsert: {
    listingId:         string
    numTransactions:   number
    avgPricePerSqm:    number
    medianPricePerSqm: number
    pctDiff:           number
    classification:    string
    benchmarkSource:   string
    soldComparables:   number
  }[] = []

  let skipped = 0

  // ── 4. Compute benchmark per group ────────────────────────────────────────
  for (const [key, group] of groups.entries()) {
    // Derive the sold-transaction lookup key: replace dealType with "sale"
    const parts   = key.split('::')   // [city, dealType, bucket]
    const soldKey = `${parts[0]}::sale::${parts[2]}`

    let benchmark: { median: number; avg: number; count: number; source: string; soldCount: number } | null = null

    const soldPrices = soldGroups.get(soldKey) ?? []
    if (soldPrices.length >= MIN_SOLD_COMPARABLES) {
      const s = trimmedStats(soldPrices)
      if (s.count >= MIN_SOLD_COMPARABLES) {
        benchmark = { ...s, source: 'sold_transactions', soldCount: s.count }
      }
    }

    if (!benchmark) {
      const activePrices = group.map(l => l.pricePerSqm)
      const s = trimmedStats(activePrices)
      if (s.count < MIN_COMPARABLES) {
        skipped += group.length
        continue
      }
      benchmark = { ...s, source: 'active_listings', soldCount: 0 }
    }

    for (const l of group) {
      const raw     = ((l.pricePerSqm - benchmark.median) / benchmark.median) * 100
      const pctDiff = Math.round(raw * 10) / 10
      toInsert.push({
        listingId:         l.id,
        numTransactions:   benchmark.count,
        avgPricePerSqm:    benchmark.avg,
        medianPricePerSqm: benchmark.median,
        pctDiff,
        classification:    classify(pctDiff),
        benchmarkSource:   benchmark.source,
        soldComparables:   benchmark.soldCount,
      })
    }
  }

  // ── 5. Persist ─────────────────────────────────────────────────────────────
  if (toInsert.length > 0) {
    await prisma.listingComparison.deleteMany({
      where: { listingId: { in: toInsert.map(u => u.listingId) } },
    })
    for (let i = 0; i < toInsert.length; i += CHUNK_SIZE) {
      await prisma.listingComparison.createMany({ data: toInsert.slice(i, i + CHUNK_SIZE) })
    }
  }

  const soldBacked = toInsert.filter(t => t.benchmarkSource === 'sold_transactions').length
  console.log(`[comparisons] ${toInsert.length} classified (${soldBacked} sold-tx backed, ${toInsert.length - soldBacked} active-listing backed), ${skipped} skipped`)

  return { processed: toInsert.length, skipped }
}
