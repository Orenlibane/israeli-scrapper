import { Component, Input, Output, EventEmitter } from '@angular/core'
import { CommonModule, DecimalPipe } from '@angular/common'
import { Listing } from '../services/api.service'

@Component({
  selector: 'app-results',
  standalone: true,
  imports: [CommonModule, DecimalPipe],
  templateUrl: './results.component.html',
  styleUrls: ['./results.component.scss'],
})
export class ResultsComponent {
  @Input() listings: Listing[] = []
  @Input() total = 0
  @Input() page = 1
  @Input() pageSize = 50
  @Output() pageChange = new EventEmitter<number>()

  get totalPages() { return Math.ceil(this.total / this.pageSize) }

  classLabel(c: string | null): string {
    const map: Record<string, string> = {
      deal: '🔥 Deal',
      below_market: '📉 Below Market',
      at_market: '✅ Market Price',
      overpriced: '⚠️ Overpriced',
    }
    return c ? (map[c] ?? c) : ''
  }

  classColor(c: string | null): string {
    const map: Record<string, string> = {
      deal: 'green',
      below_market: 'blue',
      at_market: 'gray',
      overpriced: 'red',
    }
    return c ? (map[c] ?? 'gray') : 'gray'
  }

  formatPrice(p: number): string {
    return new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 }).format(p)
  }
}
