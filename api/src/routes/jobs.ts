import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../index'

const ScanParamsSchema = z.object({
  cityId: z.number(),
  neighborhoodId: z.number().optional(),
  minPrice: z.number().optional(),
  maxPrice: z.number().optional(),
  minSqm: z.number().optional(),
  maxSqm: z.number().optional(),
  minRooms: z.number().optional(),
  maxRooms: z.number().optional(),
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

  app.get<{ Params: { id: string } }>('/api/jobs/:id', async (req) => {
    const job = await prisma.scanJob.findUnique({ where: { id: req.params.id } })
    if (!job) return { error: 'not found' }
    return job
  })

  app.get('/api/jobs', async () => {
    return prisma.scanJob.findMany({ orderBy: { startedAt: 'desc' }, take: 20 })
  })
}
