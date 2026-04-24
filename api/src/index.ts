import Fastify from 'fastify'
import cors from '@fastify/cors'
import { PrismaClient } from '@prisma/client'
import PgBoss from 'pg-boss'
import { citiesRoute } from './routes/cities'
import { listingsRoute } from './routes/listings'
import { jobsRoute } from './routes/jobs'
import { telegramBotRoute } from './routes/telegram-bot'
import { dealsRoute } from './routes/deals'
import { statsRoute } from './routes/stats'
import { registerWorkers } from './jobs/workers'
import { registerScheduler } from './jobs/scheduler'

const app = Fastify({ logger: true })
export const prisma = new PrismaClient()

async function ensureColumns() {
  const sqls = [
    `ALTER TABLE "ListingComparison" ADD COLUMN IF NOT EXISTS "benchmarkSource" TEXT NOT NULL DEFAULT 'active_listings'`,
    `ALTER TABLE "ListingComparison" ADD COLUMN IF NOT EXISTS "soldComparables" INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE "SoldTransaction"   ADD COLUMN IF NOT EXISTS "cityId" INTEGER`,
  ]
  for (const sql of sqls) {
    await prisma.$executeRawUnsafe(sql)
  }
  console.log('[startup] schema columns ensured')
}

async function start() {
  await ensureColumns()
  await app.register(cors, { origin: true })

  const boss = new PgBoss(process.env.DATABASE_URL!)
  await boss.start()
  await registerWorkers(boss, prisma)
  await registerScheduler(boss, prisma)

  app.decorate('boss', boss)
  app.decorate('prisma', prisma)

  await app.register(citiesRoute)
  await app.register(listingsRoute)
  await app.register(jobsRoute)
  await app.register(telegramBotRoute)
  await app.register(dealsRoute)
  await app.register(statsRoute)

  const port = Number(process.env.PORT ?? 3000)
  await app.listen({ port, host: '0.0.0.0' })
  console.log(`API running on http://localhost:${port}`)
}

start().catch(err => {
  console.error(err)
  process.exit(1)
})
