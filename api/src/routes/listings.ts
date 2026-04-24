import type { FastifyInstance } from 'fastify'
import { prisma } from '../index'

interface ListingQuery {
  cityId?:          string
  neighborhoodId?:  string
  minPrice?:        string
  maxPrice?:        string
  minSqm?:          string
  maxSqm?:          string
  minRooms?:        string
  maxRooms?:        string
  minFloor?:        string
  maxFloor?:        string
  minPricePerSqm?:  string
  maxPricePerSqm?:  string
  propertyTypes?:   string   // comma-separated list of Hebrew property type strings
  posterType?:      string   // 'owner' | 'agent'
  maxDays?:         string   // max days on market (firstSeenAt)
  dealType?:        string
  page?:            string
}

export async function listingsRoute(app: FastifyInstance) {
  app.get<{ Querystring: ListingQuery }>('/api/listings', async (req) => {
    const {
      cityId, neighborhoodId,
      minPrice, maxPrice,
      minSqm, maxSqm,
      minRooms, maxRooms,
      minFloor, maxFloor,
      minPricePerSqm, maxPricePerSqm,
      propertyTypes,
      posterType,
      maxDays,
      dealType = 'sale',
      page = '1',
    } = req.query

    const pageNum  = Math.max(1, Number(page))
    const pageSize = 50

    // Neighborhood: the scraper stores the raw Hebrew name (neighborhoodRaw) but
    // doesn't set the FK (neighborhoodId) on scheduled scans. Look up the name and
    // match against the text field; also include the FK path for future data.
    let nbhdName: string | null = null
    if (neighborhoodId) {
      const nbhd = await prisma.neighborhood.findUnique({
        where: { id: Number(neighborhoodId) },
        select: { nameHe: true },
      })
      nbhdName = nbhd?.nameHe ?? null
    }

    const where: Record<string, unknown> = { isActive: true, dealType }

    if (cityId)     where.cityId     = Number(cityId)
    if (posterType) where.posterType = posterType

    if (nbhdName) {
      where.OR = [
        { neighborhoodId: Number(neighborhoodId) },
        { neighborhoodRaw: { contains: nbhdName, mode: 'insensitive' } },
      ]
    }

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

    if (minFloor || maxFloor) {
      where.floor = {}
      if (minFloor) (where.floor as Record<string, number>).gte = Number(minFloor)
      if (maxFloor) (where.floor as Record<string, number>).lte = Number(maxFloor)
    }

    if (minPricePerSqm || maxPricePerSqm) {
      where.pricePerSqm = {}
      if (minPricePerSqm) (where.pricePerSqm as Record<string, number>).gte = Number(minPricePerSqm)
      if (maxPricePerSqm) (where.pricePerSqm as Record<string, number>).lte = Number(maxPricePerSqm)
    }

    if (propertyTypes) {
      where.propertyType = { in: propertyTypes.split(',').map(s => s.trim()) }
    }

    if (maxDays) {
      where.firstSeenAt = { gte: new Date(Date.now() - Number(maxDays) * 86_400_000) }
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
