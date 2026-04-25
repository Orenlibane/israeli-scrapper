import { FastifyInstance } from 'fastify'
import { Prisma, PrismaClient } from '@prisma/client'

export async function statsRoute(app: FastifyInstance) {
  const prisma = (app as any).prisma as PrismaClient

  app.get<{ Querystring: { cityId?: string; dealType?: string } }>('/api/stats', async (req) => {
    const cityId   = req.query.cityId ? Number(req.query.cityId) : undefined
    const dealType = req.query.dealType || undefined

    const listingWhere: Prisma.ListingWhereInput = { isActive: true }
    if (cityId)   listingWhere.cityId   = cityId
    if (dealType) listingWhere.dealType = dealType

    const [totalListings, recentListings, allComps, cityGrouped, byDay] = await Promise.all([

      prisma.listing.count({ where: listingWhere }),

      prisma.listing.count({
        where: { ...listingWhere, firstSeenAt: { gte: new Date(Date.now() - 86_400_000) } },
      }),

      prisma.listingComparison.findMany({
        where: { listing: listingWhere },
        select: {
          classification: true,
          pctDiff: true,
          listing: { select: { cityRaw: true, firstSeenAt: true } },
        },
      }),

      // Per-city listing count + avg price/sqm (always global — gives context even when filtered)
      prisma.listing.groupBy({
        by: ['cityRaw'],
        where: { isActive: true, pricePerSqm: { not: null }, cityRaw: { not: null } },
        _count:  { id: true },
        _avg:    { pricePerSqm: true },
        orderBy: { _count: { id: 'desc' } },
        take:    12,
      }),

      // New listings per day — last 14 days
      prisma.$queryRaw<{ date: string; count: number }[]>(
        Prisma.sql`
          SELECT TO_CHAR("firstSeenAt", 'YYYY-MM-DD') AS date,
                 COUNT(*)::int                          AS count
          FROM   "Listing"
          WHERE  "isActive" = true
            ${cityId   ? Prisma.sql`AND "cityId"   = ${cityId}`   : Prisma.empty}
            ${dealType ? Prisma.sql`AND "dealType" = ${dealType}` : Prisma.empty}
            AND  "firstSeenAt" >= NOW() - INTERVAL '14 days'
          GROUP  BY TO_CHAR("firstSeenAt", 'YYYY-MM-DD')
          ORDER  BY date ASC
        `
      ),
    ])

    // ── Aggregate comparisons ───────────────────────────────────────────────
    const classCount: Record<string, number> = {
      deal: 0, below_market: 0, at_market: 0, overpriced: 0,
    }
    const cityDeals = new Map<string, { deals: number; sumDiscount: number; sumDays: number }>()
    const now = Date.now()

    for (const c of allComps) {
      classCount[c.classification] = (classCount[c.classification] ?? 0) + 1

      if (c.classification === 'deal' || c.classification === 'below_market') {
        const city = c.listing?.cityRaw ?? 'Unknown'
        const days = c.listing?.firstSeenAt
          ? Math.floor((now - new Date(c.listing.firstSeenAt).getTime()) / 86_400_000)
          : 0
        const e = cityDeals.get(city) ?? { deals: 0, sumDiscount: 0, sumDays: 0 }
        cityDeals.set(city, {
          deals:       e.deals + 1,
          sumDiscount: e.sumDiscount + Math.abs(c.pctDiff),
          sumDays:     e.sumDays + days,
        })
      }
    }

    const distribution = ['deal', 'below_market', 'at_market', 'overpriced'].map(cls => ({
      classification: cls,
      count: classCount[cls] ?? 0,
    }))
    const totalWithComparisons = Object.values(classCount).reduce((a, b) => a + b, 0)

    const topDealCities = [...cityDeals.entries()]
      .map(([cityRaw, { deals, sumDiscount, sumDays }]) => ({
        cityRaw,
        dealCount:      deals,
        avgDiscount:    Math.round((sumDiscount / deals) * 10) / 10,
        avgDaysListed:  Math.round(sumDays / deals),
      }))
      .sort((a, b) => b.dealCount - a.dealCount)
      .slice(0, 8)

    const cityStats = cityGrouped.map(c => ({
      cityRaw:      c.cityRaw,
      listingCount: c._count.id,
      avgPriceSqm:  Math.round(c._avg.pricePerSqm ?? 0),
      dealCount:    cityDeals.get(c.cityRaw ?? '')?.deals ?? 0,
    }))

    return {
      totalListings,
      totalWithComparisons,
      recentListings,
      distribution,
      topDealCities,
      cityStats,
      listingsByDay: byDay,
    }
  })
}
