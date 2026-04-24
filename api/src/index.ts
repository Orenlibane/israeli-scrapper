import Fastify from 'fastify'
import cors from '@fastify/cors'
import { PrismaClient } from '@prisma/client'
import PgBoss from 'pg-boss'
import { citiesRoute } from './routes/cities'
import { listingsRoute } from './routes/listings'
import { jobsRoute } from './routes/jobs'
import { registerWorkers } from './jobs/workers'

const app = Fastify({ logger: true })
export const prisma = new PrismaClient()

async function start() {
  await app.register(cors, { origin: true })

  const boss = new PgBoss(process.env.DATABASE_URL!)
  await boss.start()
  await registerWorkers(boss, prisma)

  app.decorate('boss', boss)
  app.decorate('prisma', prisma)

  await app.register(citiesRoute)
  await app.register(listingsRoute)
  await app.register(jobsRoute)

  const port = Number(process.env.PORT ?? 3000)
  await app.listen({ port, host: '0.0.0.0' })
  console.log(`API running on http://localhost:${port}`)
}

start().catch(err => {
  console.error(err)
  process.exit(1)
})
