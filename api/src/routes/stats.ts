import { FastifyInstance } from 'fastify'
import { PrismaClient } from '@prisma/client'

export async function statsRoute(app: FastifyInstance) {
  const prisma = (app as any).prisma as PrismaClient

  app.get('/api/stats', async () => {
    const [totalListings, distributionRaw, dealComps, recentListings] = await Promise.all([
      prisma.listing.count({ where: { isActive: true } }),

      prisma.listingComparison.groupBy({
        by: ['classification'],
        _count: { classification: true },
      }),

      prisma.listingComparison.findMany({
        where: { classification: { in: ['deal', 'below_market'] } },
        select: {
          pctDiff: true,
          classification: true,
          listing: { select: { cityRaw: true, firstSeenAt: true } },
        },
      }),

      prisma.listing.count({
        where: {
          isActive: true,
          firstSeenAt: { gte: new Date(Date.now() - 86_400_000) },
        },
      }),
    ])

    const totalWithComparisons = distributionRaw.reduce((a, d) => a + d._count.classification, 0)

    const distribution = ['deal', 'below_market', 'at_market', 'overpriced'].map(cls => ({
      classification: cls,
      count: distributionRaw.find(d => d.classification === cls)?._count.classification ?? 0,
    }))

    const now = Date.now()
    const cityMap = new Map<string, { count: number; sumDiscount: number; sumDays: number }>()
    for (const c of dealComps) {
      const city = c.listing?.cityRaw
      if (!city) continue
      const daysOnMarket = c.listing?.firstSeenAt
        ? Math.floor((now - new Date(c.listing.firstSeenAt).getTime()) / 86_400_000)
        : 0
      const e = cityMap.get(city) ?? { count: 0, sumDiscount: 0, sumDays: 0 }
      cityMap.set(city, {
        count: e.count + 1,
        sumDiscount: e.sumDiscount + Math.abs(c.pctDiff),
        sumDays: e.sumDays + daysOnMarket,
      })
    }
    const topDealCities = [...cityMap.entries()]
      .map(([cityRaw, { count, sumDiscount, sumDays }]) => ({
        cityRaw,
        dealCount: count,
        avgDiscount: Math.round((sumDiscount / count) * 10) / 10,
        avgDaysListed: Math.round(sumDays / count),
      }))
      .sort((a, b) => b.dealCount - a.dealCount)
      .slice(0, 10)

    return { totalListings, totalWithComparisons, recentListings, distribution, topDealCities }
  })
}
