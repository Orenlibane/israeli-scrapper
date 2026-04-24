import { Component, Input, Output, EventEmitter, OnChanges } from '@angular/core'
import { CommonModule, DecimalPipe } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { Listing } from '../services/api.service'

type SortKey = 'newest' | 'oldest' | 'price_asc' | 'price_desc' | 'sqm_asc' | 'sqm_desc' | 'size_asc' | 'size_desc' | 'rooms_asc' | 'rooms_desc' | 'floor_asc' | 'floor_desc' | 'best_deal'

@Component({
  selector: 'app-results',
  standalone: true,
  imports: [CommonModule, DecimalPipe, FormsModule],
  templateUrl: './results.component.html',
  styleUrls: ['./results.component.scss'],
})
export class ResultsComponent implements OnChanges {
  @Input() listings: Listing[] = []
  @Input() total = 0
  @Input() page = 1
  @Input() pageSize = 50
  @Input() opportunitiesMode = false
  @Output() pageChange = new EventEmitter<number>()

  sortKey: SortKey = 'newest'
  sorted: Listing[] = []

  get totalPages() { return Math.ceil(this.total / this.pageSize) }

  get avgPrice(): number {
    const priced = this.listings.filter(l => l.priceNis > 0)
    return priced.length ? Math.round(priced.reduce((a, l) => a + l.priceNis, 0) / priced.length) : 0
  }

  get avgSqmPrice(): number {
    const priced = this.listings.filter(l => l.pricePerSqm)
    return priced.length ? Math.round(priced.reduce((a, l) => a + (l.pricePerSqm ?? 0), 0) / priced.length) : 0
  }

  get pageRange(): number[] {
    const total = this.totalPages
    const cur = this.page
    const delta = 2
    const range: number[] = []
    for (let i = Math.max(1, cur - delta); i <= Math.min(total, cur + delta); i++) range.push(i)
    return range
  }

  get freshCount(): number {
    return this.listings.filter(l => l.daysOnMarket <= 3).length
  }

  get dealCount(): number {
    return this.listings.filter(l => l.comparison?.classification === 'deal').length
  }

  get avgDiscount(): number {
    const deals = this.listings.filter(l => l.comparison && l.comparison.pctDiff < 0)
    if (!deals.length) return 0
    return Math.round(Math.abs(deals.reduce((a, l) => a + l.comparison!.pctDiff, 0) / deals.length) * 10) / 10
  }

  ngOnChanges() {
    this.sortKey = this.opportunitiesMode ? 'best_deal' : 'newest'
    this.resort()
  }

  resort() {
    const ls = [...this.listings]
    switch (this.sortKey) {
      case 'newest':     ls.sort((a, b) => a.daysOnMarket - b.daysOnMarket); break
      case 'oldest':     ls.sort((a, b) => b.daysOnMarket - a.daysOnMarket); break
      case 'price_asc':  ls.sort((a, b) => a.priceNis - b.priceNis); break
      case 'price_desc': ls.sort((a, b) => b.priceNis - a.priceNis); break
      case 'sqm_asc':    ls.sort((a, b) => (a.pricePerSqm ?? 9e9) - (b.pricePerSqm ?? 9e9)); break
      case 'sqm_desc':   ls.sort((a, b) => (b.pricePerSqm ?? 0) - (a.pricePerSqm ?? 0)); break
      case 'size_asc':   ls.sort((a, b) => (a.areaSqm ?? 0) - (b.areaSqm ?? 0)); break
      case 'size_desc':  ls.sort((a, b) => (b.areaSqm ?? 0) - (a.areaSqm ?? 0)); break
      case 'rooms_asc':  ls.sort((a, b) => (a.rooms ?? 0) - (b.rooms ?? 0)); break
      case 'rooms_desc': ls.sort((a, b) => (b.rooms ?? 0) - (a.rooms ?? 0)); break
      case 'floor_asc':  ls.sort((a, b) => (a.floor ?? -1) - (b.floor ?? -1)); break
      case 'floor_desc': ls.sort((a, b) => (b.floor ?? -1) - (a.floor ?? -1)); break
      case 'best_deal':  ls.sort((a, b) => (a.comparison?.pctDiff ?? 0) - (b.comparison?.pctDiff ?? 0)); break
    }
    this.sorted = ls
  }

  classLabel(c: string | null): string {
    const map: Record<string, string> = {
      deal: 'Deal', below_market: 'Below', at_market: 'Fair', overpriced: 'High',
    }
    return c ? (map[c] ?? c) : ''
  }

  classColor(c: string | null): string {
    const map: Record<string, string> = {
      deal: 'green', below_market: 'blue', at_market: 'gray', overpriced: 'red',
    }
    return c ? (map[c] ?? 'gray') : 'gray'
  }

  whyText(l: Listing): string {
    const c = l.comparison
    if (!c || !c.medianPricePerSqm || !l.pricePerSqm) return ''
    const rooms  = l.rooms ? `${l.rooms}r` : ''
    const city   = l.cityRaw ?? ''
    const saving = Math.abs(Math.round(l.priceNis * (-c.pctDiff / 100)))
    const savingFmt = saving >= 1_000_000
      ? '₪' + (saving / 1_000_000).toFixed(1) + 'M'
      : '₪' + Math.round(saving / 1000) + 'K'
    return `₪${l.pricePerSqm.toLocaleString()}/m² vs median ₪${c.medianPricePerSqm.toLocaleString()}/m² for ${rooms} in ${city} — saves ~${savingFmt} (${c.numTransactions} comparables)`
  }

  formatPrice(p: number): string {
    if (p >= 1_000_000) return '₪' + (p / 1_000_000).toFixed(p % 1_000_000 === 0 ? 0 : 2) + 'M'
    if (p >= 1_000)     return '₪' + (p / 1_000).toFixed(0) + 'K'
    return '₪' + p
  }

  formatSqmPrice(p: number | null): string {
    if (!p) return '—'
    return new Intl.NumberFormat('he-IL').format(p) + ' ₪'
  }

  whatsAppUrl(l: Listing): string {
    const isDeal = l.comparison && l.comparison.pctDiff <= -5
    const icon = isDeal ? (l.comparison!.pctDiff <= -15 ? '🔥' : '📉') : '🏠'
    const rooms = l.rooms ? `${l.rooms}r` : ''
    const sqm   = l.areaSqm ? ` · ${Math.round(l.areaSqm)}m²` : ''
    const fl    = l.floor != null ? ` · fl.${l.floor}` : ''
    const city  = [l.cityRaw, l.neighborhoodRaw].filter(Boolean).join(', ')
    const price = this.formatPrice(l.priceNis)
    const sqmP  = l.pricePerSqm ? ` (${new Intl.NumberFormat('he-IL').format(l.pricePerSqm)} ₪/m²)` : ''

    let text = `${icon} ${rooms}${sqm}${fl}\n📍 ${city}\n💰 ${price}${sqmP}`

    if (isDeal && l.comparison) {
      const pct = Math.abs(l.comparison.pctDiff).toFixed(1)
      const src = l.comparison.benchmarkSource === 'sold_transactions' ? ' (vs sold prices)' : ''
      text += `\n📉 ${pct}% below market${src}`
    }

    if (l.sourceUrl) text += `\n🔗 ${l.sourceUrl}`
    text += '\n— via Nadlan Scout'

    return `https://wa.me/?text=${encodeURIComponent(text)}`
  }
}
