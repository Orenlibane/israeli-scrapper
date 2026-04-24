import type { FastifyInstance } from 'fastify'
import { prisma } from '../index'

interface ListingQuery {
  cityId?: string
  neighborhoodId?: string
  minPrice?: string
  maxPrice?: string
  minSqm?: string
  maxSqm?: string
  minRooms?: string
  maxRooms?: string
  dealType?: string
  page?: string
}

export async function listingsRoute(app: FastifyInstance) {
  app.get<{ Querystring: ListingQuery }>('/api/listings', async (req) => {
    const {
      cityId, neighborhoodId,
      minPrice, maxPrice,
      minSqm, maxSqm,
      minRooms, maxRooms,
      dealType = 'sale',
      page = '1',
    } = req.query

    const pageNum = Math.max(1, Number(page))
    const pageSize = 50

    const where: Record<string, unknown> = { isActive: true, dealType }
    if (cityId)         where.cityId = Number(cityId)
    if (neighborhoodId) where.neighborhoodId = Number(neighborhoodId)
    if (minPrice || maxPrice) {
      where.priceNis = {}
      if (minPrice) (where.priceNis as Record<string, number>).gte = Number(minPrice)
      if (maxPrice) (where.priceNis as Record<string, number>).lte = Number(maxPrice)
    }
    if (minSqm || maxSqm) {
      where.areaSqm = {}
      if (minSqm) (where.areaSqm as Record<string, number>).gte = Number(minSqm)
      if (maxSqm) (where.areaSqm as Record<string, number>).lte = Number(maxSqm)
    }
    if (minRooms || maxRooms) {
      where.rooms = {}
      if (minRooms) (where.rooms as Record<string, number>).gte = Number(minRooms)
      if (maxRooms) (where.rooms as Record<string, number>).lte = Number(maxRooms)
    }

    const [total, listings] = await Promise.all([
      prisma.listing.count({ where }),
      prisma.listing.findMany({
        where,
        include: { comparisons: { orderBy: { computedAt: 'desc' }, take: 1 } },
        orderBy: { firstSeenAt: 'desc' },
        skip: (pageNum - 1) * pageSize,
        take: pageSize,
      }),
    ])

    return {
      total,
      page: pageNum,
      pageSize,
      data: listings.map((l: typeof listings[number]) => ({
        ...l,
        daysOnMarket: Math.floor((Date.now() - new Date(l.firstSeenAt).getTime()) / 86400000),
        comparison: l.comparisons[0] ?? null,
      })),
    }
  })
}
