import type PgBoss from 'pg-boss'
import type { PrismaClient } from '@prisma/client'
import { computeComparisons } from './comparison-worker'
import { notifyTopDeals, notifyProfileDeals, telegramEnabled } from '../services/telegram'
import { ingestSoldTransactions } from './workers'

// All DB city IDs — must match the City table seed
const CITY_IDS = [70, 650, 1200, 3000, 4000, 5000, 6200, 6300, 6400, 6600, 6900, 7400, 7900, 8300, 8400, 8600, 8700, 9000]
const DEAL_TYPES = ['sale', 'rent'] as const

// 06:00 Israel time = 03:00 UTC (summer). Adjust to 04:00 UTC in winter — cron stays 03:00 UTC year-round.
const DAILY_CRON = '0 3 * * *'

// Seconds between queued scans so Yad2 doesn't rate-limit us.
// 18 cities × 2 deal types × 40s = ~24 min total sweep.
const STAGGER_SECONDS = 40

// Seconds between Madlan jobs (less aggressive rate-limiting than Yad2).
const MADLAN_STAGGER_SECONDS = 20

// Total Yad2 jobs: 18 cities × 2 deal types = 36.
// Madlan starts after all Yad2 jobs have had time to finish:
// 36 jobs × 40s = 1440s ≈ 24 min.  Add a 60s safety buffer → 1500s.
const MADLAN_START_OFFSET_SECONDS = 36 * STAGGER_SECONDS + 60

export async function registerScheduler(boss: PgBoss, prisma: PrismaClient) {
  // Cron fires once per day, queuing one `daily-scan-all` job.
  await boss.schedule('daily-scan-all', DAILY_CRON, {})

  await boss.work('daily-scan-all', async () => {
    console.log('[scheduler] Daily scan triggered — queuing all cities…')

    let index = 0
    for (const dealType of DEAL_TYPES) {
      for (const cityId of CITY_IDS) {
        const params = { cityId, dealType }
        const job = await prisma.scanJob.create({ data: { params, status: 'pending' } })

        // startAfter staggers each scan so requests hit Yad2 ~40s apart
        await boss.send('scan-listings', { jobId: job.id, params }, {
          startAfter: index * STAGGER_SECONDS,
        })
        index++
      }
    }

    console.log(`[scheduler] Queued ${index} Yad2 scan jobs (${CITY_IDS.length} cities × ${DEAL_TYPES.length} deal types)`)

    // Queue Madlan jobs — start after all Yad2 jobs have had time to finish
    let madlanIndex = 0
    for (const dealType of DEAL_TYPES) {
      for (const cityId of CITY_IDS) {
        const params = { cityId, dealType }
        let madlanJob: { id: string }
        try {
          madlanJob = await prisma.scanJob.create({ data: { params, status: 'pending' } })
        } catch (err) {
          console.error(`[scheduler] Failed to create Madlan ScanJob city=${cityId} deal=${dealType}:`, err)
          madlanIndex++
          continue
        }

        const startAfter = MADLAN_START_OFFSET_SECONDS + madlanIndex * MADLAN_STAGGER_SECONDS
        await boss.send('scan-madlan', { jobId: madlanJob.id, params }, { startAfter })
        madlanIndex++
      }
    }

    console.log(`[scheduler] Queued ${madlanIndex} Madlan scan jobs (${CITY_IDS.length} cities × ${DEAL_TYPES.length} deal types, starting in ~${Math.round(MADLAN_START_OFFSET_SECONDS / 60)} min)`)
  })

  // Mark listings not seen in 48 h as inactive — runs daily 30 min after scans start
  await boss.schedule('mark-stale-listings', '30 3 * * *', {})

  await boss.work('mark-stale-listings', async () => {
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000)
    const { count } = await prisma.listing.updateMany({
      where: { lastSeenAt: { lt: cutoff }, isActive: true },
      data: { isActive: false },
    })
    console.log(`[scheduler] Marked ${count} stale listings inactive`)
  })

  // Market comparison engine — runs at 04:30 UTC (07:30 Israel time), 90 min after scans start
  await boss.schedule('compute-comparisons', '30 4 * * *', {})
  await boss.work('compute-comparisons', async () => {
    console.log('[comparisons] Computing market benchmarks…')
    const { processed, skipped } = await computeComparisons(prisma)
    console.log(`[comparisons] Done — ${processed} listings classified, ${skipped} skipped`)
  })

  // Weekly sold transaction ingest — Sunday 01:00 UTC (04:00 Israel time)
  // Bootstraps Playwright once, fetches all 18 cities sequentially (~30 min)
  await boss.schedule('scrape-sold-transactions', '0 1 * * 0', {})
  await ingestSoldTransactions(boss, prisma)

  // Hourly top deals digest — every hour on the hour
  await boss.schedule('notify-top-deals', '0 * * * *', {})
  await boss.work('notify-top-deals', async () => {
    if (!telegramEnabled()) return
    console.log('[scheduler] Sending hourly top deals digest…')
    await notifyTopDeals(prisma)
    console.log('[scheduler] Top deals digest sent')
  })

  // Profile deal alerts — every 30 minutes
  await boss.schedule('check-profile-alerts', '*/30 * * * *', {})
  await boss.work('check-profile-alerts', async () => {
    console.log('[scheduler] Checking profile-based deal alerts…')
    await notifyProfileDeals(prisma)
    console.log('[scheduler] Profile alert check done')
  })

  console.log(`[scheduler] Daily scan registered — cron "${DAILY_CRON}" (06:00 Israel time)`)
}
