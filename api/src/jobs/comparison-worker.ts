/**
 * Market comparison engine.
 *
 * Benchmark priority for each city+dealType+room bucket:
 *   1. Sold transactions (nadlan.gov.il) — actual paid prices, last 24 months, ≥5 comparables
 *   2. Active listing median — p10-p90 trimmed, ≥5 comparables
 *
 * Each listing is scored against the benchmark and classified.
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

export async function computeComparisons(
  prisma: PrismaClient,
): Promise<{ processed: number; skipped: number }> {

  // ── 1. Load active listings ────────────────────────────────────────────────
  const raw = await prisma.listing.findMany({
    where: {
      isActive:     true,
      pricePerSqm:  { not: null },
      cityId:       { not: null },
      rooms:        { not: null },
      priceNis:     { gte: 50_000 },
    },
    select: { id: true, cityId: true, dealType: true, rooms: true, pricePerSqm: true },
  })

  type Row = { id: string; cityId: number; dealType: string; rooms: number; pricePerSqm: number }
  const listings = raw as Row[]

  // ── 2. Load recent sold transactions (sale only, last 24 months) ───────────
  const cityIds = [...new Set(listings.map(l => l.cityId))]
  const cutoff  = new Date(Date.now() - TWO_YEARS_MS)

  const soldRaw = await prisma.soldTransaction.findMany({
    where: {
      cityId:          { not: null, in: cityIds },
      pricePerSqm:     { not: null, gte: 1_000 },
      rooms:           { not: null },
      transactionDate: { gte: cutoff },
    },
    select: { cityId: true, rooms: true, pricePerSqm: true },
  })

  // Group sold transactions by cityId:sale:bucket
  const soldGroups = new Map<string, number[]>()
  for (const tx of soldRaw) {
    if (!tx.cityId || !tx.rooms || !tx.pricePerSqm) continue
    const bucket = Math.min(5, Math.round(tx.rooms))
    const key    = `${tx.cityId}:sale:${bucket}`
    if (!soldGroups.has(key)) soldGroups.set(key, [])
    soldGroups.get(key)!.push(tx.pricePerSqm)
  }

  // ── 3. Group active listings ───────────────────────────────────────────────
  const groups = new Map<string, Row[]>()
  for (const l of listings) {
    const bucket = Math.min(5, Math.round(l.rooms))
    const key    = `${l.cityId}:${l.dealType}:${bucket}`
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
    let benchmark: { median: number; avg: number; count: number; source: string; soldCount: number }

    // Try sold transactions first (only meaningful for sale listings)
    const soldPrices = soldGroups.get(key) ?? []
    if (soldPrices.length >= MIN_SOLD_COMPARABLES) {
      const s = trimmedStats(soldPrices)
      if (s.count >= MIN_SOLD_COMPARABLES) {
        benchmark = { ...s, source: 'sold_transactions', soldCount: s.count }
      } else {
        // sold group too thin after trimming — fall through to active listings
        benchmark = null as any
      }
    } else {
      benchmark = null as any
    }

    // Fall back to active listing median
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
  console.log(`[comparisons] ${toInsert.length} classified (${soldBacked} backed by sold tx, ${toInsert.length - soldBacked} by active listings), ${skipped} skipped`)

  return { processed: toInsert.length, skipped }
}
