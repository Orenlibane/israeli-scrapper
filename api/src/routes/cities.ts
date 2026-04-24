import type { FastifyInstance } from 'fastify'
import { prisma } from '../index'

export async function citiesRoute(app: FastifyInstance) {
  app.get('/api/cities', async () => {
    return prisma.city.findMany({ orderBy: { name: 'asc' } })
  })

  app.get<{ Params: { cityId: string } }>('/api/cities/:cityId/neighborhoods', async (req) => {
    const cityId = Number(req.params.cityId)
    return prisma.neighborhood.findMany({
      where: { cityId },
      orderBy: { name: 'asc' },
    })
  })
}
