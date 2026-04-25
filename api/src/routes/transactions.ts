import { FastifyInstance } from 'fastify'
import { Prisma, PrismaClient } from '@prisma/client'

interface TxStatsRow {
  cityRaw: string
  cityId: number | null
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

interface TxTrendRow {
  cityRaw: string
  month: string
  count: number
  avgPricePerSqm: number
}

interface TxRow {
  id: string
  address: string
  cityRaw: string | null
  cityId: number | null
  priceNis: number
  areaSqm: number | null
  pricePerSqm: number | null
  rooms: number | null
  floor: number | null
  transactionDate: Date | null
}

export async function transactionsRoute(app: FastifyInstance) {
  const prisma = (app as unknown as { prisma: PrismaClient }).prisma

  app.get('/api/transactions', async (req) => {
    const q = req.query as Record<string, string>

    const cityIds = (q.cityIds ?? '')
      .split(',')
      .map(s => parseInt(s.trim(), 10))
      .filter(n => !isNaN(n) && n > 0)

    const months  = Math.min(Math.max(parseInt(q.months ?? '24', 10), 1), 120)
    const minRooms = q.minRooms ? parseFloat(q.minRooms) : undefined
    const maxRooms = q.maxRooms ? parseFloat(q.maxRooms) : undefined
    const page     = Math.max(parseInt(q.page ?? '1', 10), 1)
    const pageSize = 20

    const since = new Date(Date.now() - months * 30 * 24 * 3600 * 1000)

    // ── City stats with SQL percentiles ────────────────────────────────────
    const cityIdFilter = cityIds.length > 0
      ? Prisma.sql`AND "cityId" = ANY(ARRAY[${Prisma.join(cityIds)}]::int[])`
      : Prisma.sql``

    const roomFilter = (minRooms !== undefined || maxRooms !== undefined)
      ? Prisma.sql`AND "rooms" BETWEEN ${minRooms ?? 0} AND ${maxRooms ?? 99}`
      : Prisma.sql``

    const cityStats = await prisma.$queryRaw<TxStatsRow[]>(Prisma.sql`
      SELECT
        "cityRaw",
        "cityId",
        COUNT(*)::int                                                          AS count,
        ROUND(AVG("priceNis"))::int                                            AS "avgPrice",
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY "priceNis")::int          AS "medianPrice",
        ROUND(AVG("pricePerSqm"))::int                                         AS "avgPricePerSqm",
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY "pricePerSqm")::int       AS "medianPricePerSqm",
        ROUND(AVG("areaSqm")::numeric, 1)::float                              AS "avgAreaSqm",
        MIN("priceNis")::int                                                   AS "minPrice",
        MAX("priceNis")::int                                                   AS "maxPrice",
        ROUND(AVG("rooms")::numeric, 1)::float                                AS "avgRooms"
      FROM "SoldTransaction"
      WHERE "transactionDate" >= ${since}
        AND "priceNis"      > 0
        AND "pricePerSqm"   > 0
        ${cityIdFilter}
        ${roomFilter}
      GROUP BY "cityRaw", "cityId"
      ORDER BY count DESC
    `)

    // ── Monthly trend per city ──────────────────────────────────────────────
    const trend = await prisma.$queryRaw<TxTrendRow[]>(Prisma.sql`
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

    // ── Recent transactions (paginated) ────────────────────────────────────
    const where: Prisma.SoldTransactionWhereInput = {
      transactionDate: { gte: since },
      priceNis: { gt: 0 },
    }
    if (cityIds.length > 0) where.cityId = { in: cityIds }
    if (minRooms !== undefined) where.rooms = { gte: minRooms, lte: maxRooms ?? 99 }

    const [total, recent] = await Promise.all([
      prisma.soldTransaction.count({ where }),
      prisma.soldTransaction.findMany({
        where,
        orderBy: { transactionDate: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          address: true,
          cityRaw: true,
          cityId: true,
          priceNis: true,
          areaSqm: true,
          pricePerSqm: true,
          rooms: true,
          floor: true,
          transactionDate: true,
        },
      }),
    ])

    // Attach trend arrays to each city stat
    const cityStatsWithTrend = cityStats.map(cs => ({
      ...cs,
      trend: trend
        .filter(t => t.cityRaw === cs.cityRaw)
        .map(t => ({ month: t.month, count: t.count, avgPricePerSqm: t.avgPricePerSqm })),
    }))

    return {
      months,
      cityStats: cityStatsWithTrend,
      recentTransactions: recent,
      total,
      page,
      pageSize,
    }
  })
}
