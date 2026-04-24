/**
 * Safe schema migration that runs on every startup.
 * Uses ADD COLUMN IF NOT EXISTS so it's idempotent and never fails on re-runs.
 * This handles the case where the DB was created before Prisma migrations were
 * introduced, causing prisma migrate deploy to fail on the already-existing tables.
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  try {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "ListingComparison" ADD COLUMN IF NOT EXISTS "benchmarkSource" TEXT NOT NULL DEFAULT 'active_listings'`
    )
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "ListingComparison" ADD COLUMN IF NOT EXISTS "soldComparables" INTEGER NOT NULL DEFAULT 0`
    )
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "SoldTransaction" ADD COLUMN IF NOT EXISTS "cityId" INTEGER`
    )
    console.log('[migrate-safe] Schema columns ensured')
  } catch (err) {
    console.error('[migrate-safe] Error (non-fatal):', err)
  } finally {
    await prisma.$disconnect()
  }
}

main()
