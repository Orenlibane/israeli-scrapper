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
}
