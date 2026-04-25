import { FastifyInstance } from 'fastify'
import { Prisma, PrismaClient } from '@prisma/client'

interface CityCoverageRow {
  cityRaw: string
  listings: number
  comparisons: number
  sold_tx: number
}

export async function globalDataRoute(app: FastifyInstance) {
  const prisma = (app as unknown as { prisma: PrismaClient }).prisma

  app.get('/api/global-data', async () => {
    const [
      listingsBySource,
      soldTransactionsTotal,
      soldByCity,
      compsByBenchmark,
      cityCoverage,
      recentJobs,
      usersTotal,
      usersActive,
      profilesTotal,
      profilesActive,
      alertsTotal,
      alertsLast24h,
    ] = await Promise.all([
      prisma.listing.groupBy({
        by: ['source'],
        where: { isActive: true },
        _count: { id: true },
      }),

      prisma.soldTransaction.count(),

      prisma.soldTransaction.groupBy({
        by: ['cityRaw'],
        where: { cityRaw: { not: null } },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 10,
      }),

      prisma.listingComparison.groupBy({
        by: ['benchmarkSource'],
        where: { listing: { isActive: true } },
        _count: { id: true },
      }),

      prisma.$queryRaw<CityCoverageRow[]>(Prisma.sql`
        SELECT
          l."cityRaw",
          COUNT(DISTINCT l.id)::int  AS listings,
          COUNT(DISTINCT lc.id)::int AS comparisons,
          COUNT(DISTINCT st.id)::int AS sold_tx
        FROM "Listing" l
        LEFT JOIN "ListingComparison" lc ON lc."listingId" = l.id
        LEFT JOIN "SoldTransaction"   st ON LOWER(TRIM(st."cityRaw")) = LOWER(TRIM(l."cityRaw"))
        WHERE l."isActive" = true AND l."cityRaw" IS NOT NULL
        GROUP BY l."cityRaw"
        ORDER BY listings DESC
        LIMIT 15
      `),

      prisma.scanJob.findMany({
        orderBy: { startedAt: 'desc' },
        take: 10,
      }),

      prisma.user.count(),
      prisma.user.count({ where: { status: 'active' } }),

      prisma.searchProfile.count(),
      prisma.searchProfile.count({ where: { isActive: true } }),

      prisma.alert.count(),
      prisma.alert.count({
        where: { sentAt: { gte: new Date(Date.now() - 86400000) } },
      }),
    ])

    const soldBackedCount =
      compsByBenchmark.find(c => c.benchmarkSource === 'sold_transactions')?._count.id ?? 0
    const activeBackedCount =
      compsByBenchmark.find(c => c.benchmarkSource === 'active_listings')?._count.id ?? 0
    const totalComps = soldBackedCount + activeBackedCount
    const totalListings = listingsBySource.reduce((s, r) => s + r._count.id, 0)

    const dataSkills = [
      {
        name: 'Yad2 Scraper',
        technique: 'curl_cffi TLS impersonation',
        description:
          'Bypasses Cloudflare bot detection by impersonating browser TLS fingerprints via a Python microservice. Fetches Yad2 internal JSON API.',
        recordsCount: listingsBySource.find(r => r.source === 'yad2')?._count.id ?? 0,
        status: 'active',
      },
      {
        name: 'nadlan.gov.il Sold Transactions',
        technique: 'Playwright browser automation',
        description:
          'Playwright headless browser navigates the Israeli government real estate portal to fetch actual transaction prices. Runs weekly.',
        recordsCount: soldTransactionsTotal,
        status: 'active',
      },
      {
        name: 'Market Comparison Engine',
        technique: 'p10/p90 trimmed median + 2-tier benchmark',
        description:
          'Groups listings by city+dealType+room bucket. Uses sold transactions if ≥5 available (last 24 months), falls back to active-listing median. Classifies each listing.',
        recordsCount: totalComps,
        status: 'active',
      },
      {
        name: 'pg-boss Scheduler',
        technique: 'PostgreSQL-backed job queue',
        description:
          'Replaces Redis+Bull. Runs 6 cron jobs: daily city scan, mark stale, comparison engine, weekly sold transactions, hourly top-deal digest, per-profile alerts every 30 min.',
        recordsCount: totalListings,
        status: 'active',
      },
      {
        name: 'Telegram Webhook Bot',
        technique: 'Stateful inline keyboard onboarding',
        description:
          'Webhook-based bot without grammY. In-memory state machine for multi-step profile creation. Sends per-user deal alerts deduped via Alert table.',
        recordsCount: usersTotal,
        status: 'active',
      },
      {
        name: 'Madlan GraphQL Scraper',
        technique: 'GraphQL API reverse engineering',
        description:
          'Second listing source for cross-source validation and increased coverage.',
        recordsCount: listingsBySource.find(r => r.source === 'madlan')?._count.id ?? 0,
        status: 'planned',
      },
    ]

    return {
      listingsBySource,
      soldTransactions: {
        total: soldTransactionsTotal,
        byCity: soldByCity,
      },
      comparisons: {
        total: totalComps,
        soldBacked: soldBackedCount,
        activeListingBacked: activeBackedCount,
        byBenchmark: compsByBenchmark,
      },
      cityCoverage,
      recentJobs,
      users: {
        total: usersTotal,
        active: usersActive,
      },
      profiles: {
        total: profilesTotal,
        active: profilesActive,
      },
      alerts: {
        total: alertsTotal,
        last24h: alertsLast24h,
      },
      dataSkills,
    }
  })
}
