import { FastifyInstance } from 'fastify'
import { Prisma, PrismaClient } from '@prisma/client'

// Hebrew city names — match what Yad2 scraper stores in Listing.cityRaw
const CITY_HE: Record<number, string> = {
  5000: 'תל אביב יפו',
  3000: 'ירושלים',
  4000: 'חיפה',
  8300: 'ראשון לציון',
  7900: 'פתח תקווה',
  70:   'אשדוד',
  7400: 'נתניה',
  9000: 'באר שבע',
  6600: 'חולון',
  6200: 'בני ברק',
  8600: 'רמת גן',
  6400: 'הרצליה',
  6900: 'כפר סבא',
  8400: 'רחובות',
  1200: 'מודיעין מכבים רעות',
  8700: 'רעננה',
  650:  'אשקלון',
  6300: 'בת ים',
}

interface StatRow {
  cityRaw: string
  count: number
  avgPrice: number
  medianPrice: number
  avgPricePerSqm: number
  medianPricePerSqm: number
  avgAreaSqm: number
  minPrice: number
  maxPrice: number
  avgRooms: number
}

interface TrendRow {
  cityRaw: string
  month: string
  count: number
  avgPricePerSqm: number
}

export async function transactionsRoute(app: FastifyInstance) {
  const prisma = (app as unknown as { prisma: PrismaClient }).prisma

  app.get('/api/transactions', async (req) => {
    const q = req.query as Record<string, string>

    const cityIds = (q.cityIds ?? '')
      .split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n) && n > 0)

    const months   = Math.min(Math.max(parseInt(q.months ?? '24', 10), 1), 120)
    const dealType = (q.dealType === 'rent') ? 'rent' : 'sale'
    const minRooms = q.minRooms ? parseFloat(q.minRooms) : undefined
    const maxRooms = q.maxRooms ? parseFloat(q.maxRooms) : undefined
    const sort     = q.sort ?? 'newest'
    const page     = Math.max(parseInt(q.page ?? '1', 10), 1)
    const pageSize = 20
    const since    = new Date(Date.now() - months * 30 * 24 * 3600 * 1000)

    // ── Decide data source ─────────────────────────────────────────────────
    // Prefer government sold-transaction data; fall back to active listings.
    const soldCount = await prisma.soldTransaction.count()
    const useListings = soldCount === 0

    // Hebrew city names for the Listing.cityRaw filter
    const cityRaws = cityIds.map(id => CITY_HE[id]).filter(Boolean)

    const roomFilter = (minRooms !== undefined || maxRooms !== undefined)
      ? Prisma.sql`AND "rooms" BETWEEN ${minRooms ?? 0} AND ${maxRooms ?? 99}`
      : Prisma.sql``

    let cityStats: StatRow[]
    let trend: TrendRow[]
    let recentRows: unknown[]
    let total: number

    if (useListings) {
      // ── Active listings (Yad2 + Madlan) ──────────────────────────────────
      const cityFilter = cityRaws.length > 0
        ? Prisma.sql`AND "cityRaw" = ANY(ARRAY[${Prisma.join(cityRaws)}])`
        : Prisma.sql``

      cityStats = await prisma.$queryRaw<StatRow[]>(Prisma.sql`
        SELECT
          "cityRaw",
          COUNT(*)::int                                                         AS count,
          ROUND(AVG("priceNis"))::int                                           AS "avgPrice",
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY "priceNis")::int         AS "medianPrice",
          ROUND(AVG("pricePerSqm"))::int                                        AS "avgPricePerSqm",
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY "pricePerSqm")::int      AS "medianPricePerSqm",
          ROUND(AVG("areaSqm")::numeric, 1)::float                             AS "avgAreaSqm",
          MIN("priceNis")::int                                                  AS "minPrice",
          MAX("priceNis")::int                                                  AS "maxPrice",
          ROUND(AVG("rooms")::numeric, 1)::float                               AS "avgRooms"
        FROM "Listing"
        WHERE "isActive" = true
          AND "priceNis"    > 0
          AND "pricePerSqm" > 0
          AND "dealType"    = ${dealType}
          ${cityFilter}
          ${roomFilter}
        GROUP BY "cityRaw"
        ORDER BY count DESC
      `)

      trend = await prisma.$queryRaw<TrendRow[]>(Prisma.sql`
        SELECT
          "cityRaw",
          TO_CHAR("firstSeenAt", 'YYYY-MM') AS month,
          COUNT(*)::int                      AS count,
          ROUND(AVG("pricePerSqm"))::int     AS "avgPricePerSqm"
        FROM "Listing"
        WHERE "isActive" = true
          AND "firstSeenAt" >= ${since}
          AND "pricePerSqm"  > 0
          AND "dealType"     = ${dealType}
          ${cityFilter}
          ${roomFilter}
        GROUP BY "cityRaw", month
        ORDER BY "cityRaw", month
      `)

      // Recent listings as the "transaction" list
      const listingWhere: Prisma.ListingWhereInput = {
        isActive: true,
        priceNis: { gt: 0 },
        dealType,
      }
      if (cityRaws.length > 0) listingWhere.cityRaw = { in: cityRaws }
      if (minRooms !== undefined) listingWhere.rooms = { gte: minRooms, lte: maxRooms ?? 99 }

      const listingOrderBy: Prisma.ListingOrderByWithRelationInput =
        sort === 'price_asc'  ? { priceNis: 'asc' }       :
        sort === 'price_desc' ? { priceNis: 'desc' }      :
        sort === 'ppsqm_asc'  ? { pricePerSqm: 'asc' }   :
        sort === 'ppsqm_desc' ? { pricePerSqm: 'desc' }  :
        sort === 'best_deal'  ? { pricePerSqm: 'asc' }   :
        sort === 'worst_deal' ? { pricePerSqm: 'desc' }  :
                                { firstSeenAt: 'desc' }

      const [cnt, rows] = await Promise.all([
        prisma.listing.count({ where: listingWhere }),
        prisma.listing.findMany({
          where: listingWhere,
          orderBy: listingOrderBy,
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: {
            id: true, cityRaw: true, street: true,
            priceNis: true, areaSqm: true, pricePerSqm: true,
            rooms: true, floor: true, firstSeenAt: true,
            source: true, sourceUrl: true,
          },
        }),
      ])
      total = cnt
      recentRows = rows.map((r: any) => ({
        id:              r.id,
        address:         r.street ?? '—',
        cityRaw:         r.cityRaw,
        cityId:          cityIds.find(id => CITY_HE[id] === r.cityRaw) ?? null,
        priceNis:        r.priceNis,
        areaSqm:         r.areaSqm,
        pricePerSqm:     r.pricePerSqm,
        rooms:           r.rooms,
        floor:           r.floor,
        transactionDate: r.firstSeenAt,   // reuse same field name for UI compat
        source:          r.source,
        sourceUrl:       r.sourceUrl,
      }))

    } else {
      // ── Sold transactions (government data) ───────────────────────────────
      const cityIdFilter = cityIds.length > 0
        ? Prisma.sql`AND "cityId" = ANY(ARRAY[${Prisma.join(cityIds)}]::int[])`
        : Prisma.sql``

      cityStats = await prisma.$queryRaw<StatRow[]>(Prisma.sql`
        SELECT
          "cityRaw",
          COUNT(*)::int                                                         AS count,
          ROUND(AVG("priceNis"))::int                                           AS "avgPrice",
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY "priceNis")::int         AS "medianPrice",
          ROUND(AVG("pricePerSqm"))::int                                        AS "avgPricePerSqm",
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY "pricePerSqm")::int      AS "medianPricePerSqm",
          ROUND(AVG("areaSqm")::numeric, 1)::float                             AS "avgAreaSqm",
          MIN("priceNis")::int                                                  AS "minPrice",
          MAX("priceNis")::int                                                  AS "maxPrice",
          ROUND(AVG("rooms")::numeric, 1)::float                               AS "avgRooms"
        FROM "SoldTransaction"
        WHERE "transactionDate" >= ${since}
          AND "priceNis"    > 0
          AND "pricePerSqm" > 0
          ${cityIdFilter}
          ${roomFilter}
        GROUP BY "cityRaw", "cityId"
        ORDER BY count DESC
      `)

      trend = await prisma.$queryRaw<TrendRow[]>(Prisma.sql`
        SELECT
          "cityRaw",
          TO_CHAR("transactionDate", 'YYYY-MM') AS month,
          COUNT(*)::int                          AS count,
          ROUND(AVG("pricePerSqm"))::int         AS "avgPricePerSqm"
        FROM "SoldTransaction"
        WHERE "transactionDate" >= ${since}
          AND "pricePerSqm" > 0
          ${cityIdFilter}
          ${roomFilter}
        GROUP BY "cityRaw", month
        ORDER BY "cityRaw", month
      `)

      const where: Prisma.SoldTransactionWhereInput = {
        transactionDate: { gte: since }, priceNis: { gt: 0 },
      }
      if (cityIds.length > 0) where.cityId = { in: cityIds }
      if (minRooms !== undefined) where.rooms = { gte: minRooms, lte: maxRooms ?? 99 }

      const soldOrderBy: Prisma.SoldTransactionOrderByWithRelationInput =
        sort === 'price_asc'  ? { priceNis: 'asc' }       :
        sort === 'price_desc' ? { priceNis: 'desc' }      :
        sort === 'ppsqm_asc'  ? { pricePerSqm: 'asc' }   :
        sort === 'ppsqm_desc' ? { pricePerSqm: 'desc' }  :
        sort === 'best_deal'  ? { pricePerSqm: 'asc' }   :
        sort === 'worst_deal' ? { pricePerSqm: 'desc' }  :
                                { transactionDate: 'desc' }

      const [cnt, rows] = await Promise.all([
        prisma.soldTransaction.count({ where }),
        prisma.soldTransaction.findMany({
          where,
          orderBy: soldOrderBy,
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: {
            id: true, address: true, cityRaw: true, cityId: true,
            priceNis: true, areaSqm: true, pricePerSqm: true,
            rooms: true, floor: true, transactionDate: true,
          },
        }),
      ])
      total = cnt
      recentRows = rows
    }

    const cityStatsWithTrend = cityStats.map(cs => ({
      ...cs,
      trend: trend
        .filter(t => t.cityRaw === cs.cityRaw)
        .map(t => ({ month: t.month, count: t.count, avgPricePerSqm: t.avgPricePerSqm })),
    }))

    return {
      months,
      dealType,
      dataSource: useListings ? 'active_listings' : 'sold_transactions',
      cityStats: cityStatsWithTrend,
      recentTransactions: recentRows,
      total,
      page,
      pageSize,
    }
  })
}
