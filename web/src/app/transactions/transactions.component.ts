import { Component, OnInit, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { ApiService, TxCityStat, SoldTx, TransactionsResponse } from '../services/api.service'

const QUICK_CITIES = [
  { id: 5000, label: 'Tel Aviv',         labelHe: 'תל אביב' },
  { id: 3000, label: 'Jerusalem',        labelHe: 'ירושלים' },
  { id: 4000, label: 'Haifa',            labelHe: 'חיפה' },
  { id: 8300, label: 'Rishon LeZion',    labelHe: 'ראשון לציון' },
  { id: 7400, label: 'Netanya',          labelHe: 'נתניה' },
  { id: 70,   label: 'Ashdod',           labelHe: 'אשדוד' },
  { id: 9000, label: 'Beer Sheva',       labelHe: 'באר שבע' },
  { id: 7900, label: 'Petah Tikva',      labelHe: 'פתח תקווה' },
  { id: 8600, label: 'Ramat Gan',        labelHe: 'רמת גן' },
  { id: 6400, label: 'Herzliya',         labelHe: 'הרצליה' },
  { id: 6600, label: 'Holon',            labelHe: 'חולון' },
  { id: 8700, label: "Ra'anana",         labelHe: 'רעננה' },
  { id: 6900, label: 'Kfar Saba',        labelHe: 'כפר סבא' },
  { id: 1200, label: "Modi'in",          labelHe: 'מודיעין' },
  { id: 650,  label: 'Ashkelon',         labelHe: 'אשקלון' },
  { id: 8400, label: 'Rehovot',          labelHe: 'רחובות' },
  { id: 6300, label: 'Bat Yam',          labelHe: 'בת ים' },
  { id: 6200, label: 'Bnei Brak',        labelHe: 'בני ברק' },
]

const CITY_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4']

@Component({
  selector: 'app-transactions',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './transactions.component.html',
  styleUrls: ['./transactions.component.scss'],
})
export class TransactionsComponent implements OnInit {
  private api = inject(ApiService)

  readonly cities = QUICK_CITIES
  readonly monthOptions = [
    { label: '3 months',  value: 3 },
    { label: '6 months',  value: 6 },
    { label: '1 year',    value: 12 },
    { label: '2 years',   value: 24 },
    { label: '3 years',   value: 36 },
  ]

  selectedCityIds = new Set<number>([5000, 3000])  // default: TA + Jerusalem
  months = 24
  minRooms: number | undefined
  maxRooms: number | undefined
  page = 1

  loading = false
  data: TransactionsResponse | null = null

  ngOnInit() {
    this.load()
  }

  toggleCity(id: number) {
    if (this.selectedCityIds.has(id)) {
      if (this.selectedCityIds.size > 1) this.selectedCityIds.delete(id)
    } else {
      if (this.selectedCityIds.size < 3) this.selectedCityIds.add(id)
    }
  }

  setRooms(min: number, max: number) {
    if (this.minRooms === min && this.maxRooms === max) {
      this.minRooms = undefined
      this.maxRooms = undefined
    } else {
      this.minRooms = min
      this.maxRooms = max
    }
  }

  load(p = 1) {
    this.page = p
    this.loading = true
    this.api.getTransactions({
      cityIds: [...this.selectedCityIds],
      months: this.months,
      minRooms: this.minRooms,
      maxRooms: this.maxRooms,
      page: this.page,
    }).subscribe({
      next: d => { this.data = d; this.loading = false },
      error: () => { this.loading = false },
    })
  }

  cityColor(cityRaw: string): string {
    if (!this.data) return CITY_COLORS[0]
    const idx = this.data.cityStats.findIndex(c => c.cityRaw === cityRaw)
    return CITY_COLORS[idx % CITY_COLORS.length]
  }

  cityColorByIdx(i: number): string {
    return CITY_COLORS[i % CITY_COLORS.length]
  }

  formatPrice(n: number | null): string {
    if (!n) return '—'
    if (n >= 1_000_000) return '₪' + (n / 1_000_000).toFixed(2).replace(/\.?0+$/, '') + 'M'
    return '₪' + Math.round(n / 1000) + 'K'
  }

  formatPricePerSqm(n: number | null): string {
    if (!n) return '—'
    return '₪' + n.toLocaleString()
  }

  formatDate(iso: string | null): string {
    if (!iso) return '—'
    return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  }

  cityName(id: number): string {
    return this.cities.find(c => c.id === id)?.label ?? String(id)
  }

  isRoomActive(min: number, max: number): boolean {
    return this.minRooms === min && this.maxRooms === max
  }

  // ── Trend chart helpers ──────────────────────────────────────────────────

  get allMonths(): string[] {
    const set = new Set<string>()
    this.data?.cityStats.forEach(cs => cs.trend.forEach(t => set.add(t.month)))
    return [...set].sort()
  }

  trendBarHeight(stat: TxCityStat, month: string): number {
    const maxPps = Math.max(...stat.trend.map(t => t.avgPricePerSqm), 1)
    const val = stat.trend.find(t => t.month === month)?.avgPricePerSqm ?? 0
    return Math.round((val / maxPps) * 100)
  }

  trendValue(stat: TxCityStat, month: string): number {
    return stat.trend.find(t => t.month === month)?.avgPricePerSqm ?? 0
  }

  // ── SVG line chart ───────────────────────────────────────────────────────

  readonly chartW = 560
  readonly chartH = 120
  readonly padL = 0
  readonly padR = 0

  trendPath(stat: TxCityStat): string {
    const months = this.allMonths
    if (!months.length) return ''
    const globalMax = Math.max(
      ...this.data!.cityStats.flatMap(cs => cs.trend.map(t => t.avgPricePerSqm)),
      1,
    )
    const globalMin = Math.min(
      ...this.data!.cityStats.flatMap(cs => cs.trend.map(t => t.avgPricePerSqm).filter(v => v > 0)),
      0,
    )
    const range = globalMax - globalMin || 1

    const pts = months.map((m, i) => {
      const x = months.length > 1 ? (i / (months.length - 1)) * this.chartW : this.chartW / 2
      const v = stat.trend.find(t => t.month === m)?.avgPricePerSqm ?? 0
      const y = v > 0 ? this.chartH - ((v - globalMin) / range) * this.chartH : NaN
      return { x, y, valid: !isNaN(y) && v > 0 }
    })

    // Build SVG path — skip missing points
    let d = ''
    let inLine = false
    for (const pt of pts) {
      if (!pt.valid) { inLine = false; continue }
      d += inLine ? ` L ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}` : `M ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`
      inLine = true
    }
    return d
  }

  xLabelStride(): number {
    return Math.max(1, Math.floor(this.allMonths.length / 6))
  }

  get hasTrend(): boolean {
    return this.data?.cityStats.some(cs => cs.trend.length > 1) ?? false
  }

  get totalPages(): number {
    if (!this.data) return 1
    return Math.ceil(this.data.total / this.data.pageSize)
  }

  get pages(): number[] {
    const total = this.totalPages
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
    const p = this.page
    const set = new Set([1, 2, p - 1, p, p + 1, total - 1, total].filter(x => x >= 1 && x <= total))
    return [...set].sort((a, b) => a - b)
  }
}
