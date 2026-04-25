import { Component, OnInit, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { ApiService, ProfileWithUser } from '../services/api.service'

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './settings.component.html',
  styleUrls: ['./settings.component.scss'],
})
export class SettingsComponent implements OnInit {
  private api = inject(ApiService)

  profiles: ProfileWithUser[] = []
  loading = false
  savingId: string | null = null

  readonly intervalOptions = [
    { label: 'Every hour',  value: 1 },
    { label: 'Every 2h',   value: 2 },
    { label: 'Every 4h',   value: 4 },
    { label: 'Every 8h',   value: 8 },
    { label: 'Once a day', value: 24 },
  ]

  readonly schedules = [
    { label: 'Daily city scan',           cron: '0 3 * * *',    note: '06:00 Israel time — scrapes all 18 cities × 2 deal types' },
    { label: 'Mark stale listings',       cron: '30 3 * * *',   note: 'Deactivates listings not seen in 48 h' },
    { label: 'Comparison engine',         cron: '30 4 * * *',   note: '07:30 Israel time — classifies all active listings' },
    { label: 'Per-profile alerts',        cron: '*/30 * * * *', note: 'Every 30 min — checks and sends due profile alerts' },
    { label: 'Hourly top-deals digest',   cron: '0 * * * *',    note: 'Broadcasts top 8 deals to configured Telegram channels' },
    { label: 'Weekly sold transactions',  cron: '0 1 * * 0',    note: 'Sunday 04:00 Israel time — ingests nadlan.gov.il data via Playwright' },
  ]

  ngOnInit() {
    this.loadProfiles()
  }

  loadProfiles() {
    this.loading = true
    this.api.getProfiles().subscribe({
      next: p => { this.profiles = p; this.loading = false },
      error: () => { this.loading = false },
    })
  }

  toggleActive(p: ProfileWithUser) {
    this.savingId = p.id
    this.api.updateProfile(p.id, { isActive: !p.isActive }).subscribe({
      next: updated => {
        const idx = this.profiles.findIndex(x => x.id === updated.id)
        if (idx >= 0) this.profiles[idx] = updated
        this.savingId = null
      },
      error: () => { this.savingId = null },
    })
  }

  changeInterval(p: ProfileWithUser, hours: number) {
    this.savingId = p.id
    this.api.updateProfile(p.id, { scanIntervalHours: hours }).subscribe({
      next: updated => {
        const idx = this.profiles.findIndex(x => x.id === updated.id)
        if (idx >= 0) this.profiles[idx] = updated
        this.savingId = null
      },
      error: () => { this.savingId = null },
    })
  }

  deleteProfile(p: ProfileWithUser) {
    if (!confirm(`Delete profile "${p.name}"?`)) return
    this.api.deleteProfile(p.id).subscribe({
      next: () => { this.profiles = this.profiles.filter(x => x.id !== p.id) },
    })
  }

  formatLastSent(iso: string | null): string {
    if (!iso) return 'Never'
    const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3600000)
    if (h < 1) return 'Just now'
    if (h < 24) return `${h}h ago`
    return `${Math.floor(h / 24)}d ago`
  }

  formatPrice(n: number | null): string {
    if (!n) return '—'
    if (n >= 1_000_000) return '₪' + (n / 1_000_000).toFixed(1) + 'M'
    return '₪' + Math.round(n / 1000) + 'K'
  }
}
