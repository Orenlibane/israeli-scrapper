import { Component, OnInit, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { ApiService, GlobalData } from '../services/api.service'

@Component({
  selector: 'app-global-data',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './global-data.component.html',
  styleUrls: ['./global-data.component.scss'],
})
export class GlobalDataComponent implements OnInit {
  private api = inject(ApiService)

  data: GlobalData | null = null
  loading = false

  ngOnInit() {
    this.loading = true
    this.api.getGlobalData().subscribe({
      next: d => { this.data = d; this.loading = false },
      error: () => { this.loading = false },
    })
  }

  skillStatusClass(status: string): string {
    return status === 'active' ? 'skill-active' : status === 'available' ? 'skill-available' : 'skill-planned'
  }

  skillStatusLabel(status: string): string {
    return status === 'active' ? 'Active' : status === 'available' ? 'Available' : 'Planned'
  }

  formatCount(n: number): string {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
    if (n >= 1_000) return Math.round(n / 1000) + 'K'
    return String(n)
  }

  formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
  }

  jobStatusClass(status: string): string {
    if (status === 'done') return 'job-done'
    if (status === 'failed') return 'job-failed'
    if (status === 'running') return 'job-running'
    return 'job-pending'
  }

  get soldBackedPct(): number {
    if (!this.data?.comparisons.total) return 0
    return Math.round((this.data.comparisons.soldBacked / this.data.comparisons.total) * 100)
  }

  get maxCityCoverage(): number {
    if (!this.data?.cityCoverage.length) return 1
    return Math.max(...this.data.cityCoverage.map(c => c.listings))
  }

  get totalListings(): number {
    if (!this.data) return 0
    return this.data.listingsBySource.reduce((sum, s) => sum + s.count, 0)
  }

  get maxSourceCount(): number {
    if (!this.data?.listingsBySource.length) return 1
    return Math.max(...this.data.listingsBySource.map(s => s.count))
  }

  sourceColor(index: number): string {
    const colors = ['#4f8ef7', '#6366f1', '#10b981', '#f59e0b', '#f87171']
    return colors[index % colors.length]
  }

  sourceBarWidth(count: number): number {
    return this.maxSourceCount > 0 ? Math.round((count / this.maxSourceCount) * 100) : 0
  }

  jobDuration(start: string, end: string): string {
    const secs = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000)
    return secs >= 60 ? `${Math.floor(secs / 60)}m ${secs % 60}s` : `${secs}s`
  }

  getJobLabel(params: unknown): string {
    const p = params as Record<string, unknown> | null
    if (!p) return '—'
    const parts: string[] = []
    if (p['cityId']) parts.push(`City ${p['cityId']}`)
    if (p['dealType']) parts.push(String(p['dealType']))
    return parts.join(' · ') || '—'
  }

  // Donut chart for benchmark sources (r=40, circ≈251.3)
  private readonly BENCH_R    = 40
  private readonly BENCH_CIRC = 2 * Math.PI * 40

  get benchDonutSegments(): { color: string; dashArray: string; dashOffset: number; label: string; pct: number }[] {
    if (!this.data?.comparisons.total) return []
    const circ = this.BENCH_CIRC
    const total = this.data.comparisons.total || 1
    const items = [
      { label: 'Sold Tx', count: this.data.comparisons.soldBacked, color: '#4f8ef7' },
      { label: 'Active Listings', count: this.data.comparisons.activeListingBacked, color: '#475569' },
    ]
    let cumulative = 0
    return items.map(item => {
      const pct = item.count / total
      const seg = {
        label: item.label,
        color: item.color,
        dashArray: `${pct * circ} ${circ}`,
        dashOffset: -(cumulative * circ),
        pct: Math.round(pct * 100),
      }
      cumulative += pct
      return seg
    })
  }

  skillIcon(name: string): string {
    if (name.includes('Yad2'))       return 'scraper'
    if (name.includes('nadlan'))     return 'govt'
    if (name.includes('Comparison')) return 'engine'
    if (name.includes('pg-boss'))    return 'scheduler'
    if (name.includes('Telegram'))   return 'bot'
    return 'planned'
  }
}
