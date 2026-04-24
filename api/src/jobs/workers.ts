import type PgBoss from 'pg-boss'
import type { PrismaClient } from '@prisma/client'

const SCRAPER_URL = process.env.SCRAPER_URL ?? 'http://localhost:8001'

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

      let saved = 0
      for (const l of listings) {
        await upsertListing(prisma, l)
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

async function upsertListing(prisma: PrismaClient, l: ScrapedListing) {
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
  }

  await prisma.listing.upsert({
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
}
