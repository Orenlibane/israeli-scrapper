import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../index'
import { computeComparisons } from '../jobs/comparison-worker'
import { notifyTopDeals, telegramEnabled } from '../services/telegram'

const ScanParamsSchema = z.object({
  cityId: z.coerce.number(),
  neighborhoodId: z.coerce.number().optional(),
  minPrice: z.coerce.number().optional(),
  maxPrice: z.coerce.number().optional(),
  minSqm: z.coerce.number().optional(),
  maxSqm: z.coerce.number().optional(),
  minRooms: z.coerce.number().optional(),
  maxRooms: z.coerce.number().optional(),
  dealType: z.enum(['sale', 'rent']).default('sale'),
})

export async function jobsRoute(app: FastifyInstance) {
  app.post('/api/jobs/scan', async (req, reply) => {
    const params = ScanParamsSchema.parse(req.body)

    const job = await prisma.scanJob.create({ data: { params, status: 'pending' } })

    const boss = (app as unknown as { boss: import('pg-boss') }).boss
    await boss.send('scan-listings', { jobId: job.id, params })

    reply.code(202)
    return { jobId: job.id, status: 'pending' }
  })

  // Manual trigger: runs synchronously and returns results immediately
  app.post('/api/jobs/compute-comparisons', async (req, reply) => {
    try {
      const { processed, skipped } = await computeComparisons(prisma)
      return { status: 'done', processed, skipped }
    } catch (err) {
      reply.code(500)
      return { error: String(err) }
    }
  })

  app.post('/api/jobs/notify-telegram', async (req, reply) => {
    if (!telegramEnabled()) {
      reply.code(503)
      return { error: 'Telegram not configured — set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in Railway env vars' }
    }
    try {
      await notifyTopDeals(prisma)
      return { status: 'sent' }
    } catch (err) {
      reply.code(500)
      return { error: String(err) }
    }
  })

  // Manually queue the weekly sold-transactions ingest job for testing
  app.post('/api/jobs/ingest-sold-transactions', async (req, reply) => {
    const boss = (app as unknown as { boss: import('pg-boss') }).boss
    if (!boss) {
      reply.code(503)
      return { error: 'pg-boss not available' }
    }
    try {
      await boss.send('scrape-sold-transactions', {})
      return { queued: true, message: 'Sold transaction ingest queued — check Railway logs in ~5 min' }
    } catch (err) {
      reply.code(500)
      return { error: String(err) }
    }
  })

  app.get('/api/jobs/telegram-status', async () => {
    return { configured: telegramEnabled() }
  })

  app.get<{ Params: { id: string } }>('/api/jobs/:id', async (req) => {
    const job = await prisma.scanJob.findUnique({ where: { id: req.params.id } })
    if (!job) return { error: 'not found' }
    return job
  })

  app.get('/api/jobs', async () => {
    return prisma.scanJob.findMany({ orderBy: { startedAt: 'desc' }, take: 20 })
  })
}
