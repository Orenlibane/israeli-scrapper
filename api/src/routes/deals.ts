import type { FastifyInstance } from 'fastify'
import { prisma } from '../index'

interface DealsQuery {
  cityId?:   string
  dealType?: string
  minRooms?: string
  maxRooms?: string
  page?:     string
}

export async function dealsRoute(app: FastifyInstance) {
  app.get<{ Querystring: DealsQuery }>('/api/deals', async (req) => {
    const {
      cityId,
      dealType = 'sale',
      minRooms,
      maxRooms,
      page = '1',
    } = req.query

    const pageNum  = Math.max(1, Number(page))
    const pageSize = 50

    const listingWhere: Record<string, unknown> = { isActive: true, dealType }
    if (cityId)   listingWhere.cityId = Number(cityId)
    if (minRooms || maxRooms) {
      listingWhere.rooms = {}
      if (minRooms) (listingWhere.rooms as Record<string, number>).gte = Number(minRooms)
      if (maxRooms) (listingWhere.rooms as Record<string, number>).lte = Number(maxRooms)
    }

    // Fetch comparisons sorted by biggest discount, joining through to the listing filter
    const [total, comps] = await Promise.all([
      prisma.listingComparison.count({
        where: {
          classification: { in: ['deal', 'below_market'] },
          listing: listingWhere,
        },
      }),
      prisma.listingComparison.findMany({
        where: {
          classification: { in: ['deal', 'below_market'] },
          listing: listingWhere,
        },
        orderBy: { pctDiff: 'asc' }, // most discounted first
        skip:    (pageNum - 1) * pageSize,
        take:    pageSize,
        select: {
          listingId:         true,
          pctDiff:           true,
          classification:    true,
          medianPricePerSqm: true,
          avgPricePerSqm:    true,
          numTransactions:   true,
          computedAt:        true,
        },
      }),
    ])

    if (!comps.length) return { total, page: pageNum, pageSize, data: [] }

    const listingIds = comps.map(c => c.listingId)
    const listings   = await prisma.listing.findMany({ where: { id: { in: listingIds } } })
    const byId       = new Map(listings.map(l => [l.id, l]))

    const data = comps
      .filter(c => byId.has(c.listingId))
      .map(c => {
        const l = byId.get(c.listingId)!
        return {
          ...l,
          daysOnMarket: Math.floor((Date.now() - new Date(l.firstSeenAt).getTime()) / 86400000),
          comparison: c,
        }
      })

    return { total, page: pageNum, pageSize, data }
  })
}
