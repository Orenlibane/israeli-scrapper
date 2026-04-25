import { FastifyInstance } from 'fastify'
import { PrismaClient } from '@prisma/client'

// City name lookup (same IDs as telegram-bot)
const CITY_NAMES: Record<number, string> = {
  5000: 'Tel Aviv', 3000: 'Jerusalem', 4000: 'Haifa', 8300: 'Rishon LeZion',
  7900: 'Petah Tikva', 70: 'Ashdod', 7400: 'Netanya', 9000: 'Beer Sheva',
  6600: 'Holon', 6200: 'Bnei Brak', 8600: 'Ramat Gan', 6400: 'Herzliya',
  6900: 'Kfar Saba', 8400: 'Rehovot', 1200: "Modi'in", 8700: "Ra'anana",
  650: 'Ashkelon', 6300: 'Bat Yam',
}

interface PatchBody {
  isActive?: boolean
  scanIntervalHours?: number
}

export async function profilesRoute(app: FastifyInstance) {
  const prisma = (app as unknown as { prisma: PrismaClient }).prisma

  app.get('/api/profiles', async () => {
    const profiles = await prisma.searchProfile.findMany({
      include: {
        user: {
          select: {
            telegramChatId: true,
            telegramUsername: true,
            status: true,
          },
        },
        _count: {
          select: { alerts: true },
        },
      },
    })

    return profiles.map(profile => ({
      ...profile,
      cityNames: (profile.cityIds as number[]).map(
        (id: number) => CITY_NAMES[id] ?? String(id),
      ),
      alertCount: profile._count.alerts,
    }))
  })

  app.patch<{ Params: { id: string }; Body: PatchBody }>(
    '/api/profiles/:id',
    async (req, reply) => {
      const { id } = req.params
      if (!id) {
        return reply.status(400).send({ error: 'Invalid profile id' })
      }

      const existing = await prisma.searchProfile.findUnique({ where: { id } })
      if (!existing) {
        return reply.status(404).send({ error: 'Profile not found' })
      }

      const { isActive, scanIntervalHours } = req.body

      const updateData: { isActive?: boolean; scanIntervalHours?: number } = {}
      if (isActive !== undefined) updateData.isActive = isActive
      if (scanIntervalHours !== undefined) updateData.scanIntervalHours = scanIntervalHours

      const updated = await prisma.searchProfile.update({
        where: { id },
        data: updateData,
      })

      if (isActive === true) {
        await prisma.user.update({
          where: { id: existing.userId },
          data: { status: 'active' },
        })
      }

      return updated
    },
  )

  app.delete<{ Params: { id: string } }>(
    '/api/profiles/:id',
    async (req, reply) => {
      const { id } = req.params
      if (!id) {
        return reply.status(400).send({ error: 'Invalid profile id' })
      }

      const existing = await prisma.searchProfile.findUnique({ where: { id } })
      if (!existing) {
        return reply.status(404).send({ error: 'Profile not found' })
      }

      await prisma.searchProfile.delete({ where: { id } })
      return { deleted: true }
    },
  )
}
