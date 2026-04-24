import { Component, OnInit, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { interval, Subscription } from 'rxjs'
import { switchMap, takeWhile } from 'rxjs/operators'
import { ApiService, City, Neighborhood, Listing, ScanParams, Stats } from '../services/api.service'
import { ResultsComponent } from '../results/results.component'

@Component({
  selector: 'app-search',
  standalone: true,
  imports: [CommonModule, FormsModule, ResultsComponent],
  templateUrl: './search.component.html',
  styleUrls: ['./search.component.scss'],
})
export class SearchComponent implements OnInit {
  private api = inject(ApiService)

  cities: City[] = []
  neighborhoods: Neighborhood[] = []
  listings: Listing[] = []
  total = 0

  params: ScanParams = { cityId: 0, dealType: 'sale' }
  page = 1

  scanning = false
  scanStatus = ''
  jobId: string | null = null
  private pollSub?: Subscription

  mode: 'search' | 'opportunities' | 'dashboard' | 'about' = 'search'
  computingComparisons = false
  comparisonStatus = ''

  stats: Stats | null = null
  loadingStats = false

  // Multi-select property types
  selectedPropertyTypes = new Set<string>()

  readonly quickCities = [
    { id: 5000, label: 'תל אביב' },
    { id: 3000, label: 'ירושלים' },
    { id: 4000, label: 'חיפה' },
    { id: 8300, label: 'ראשון לציון' },
    { id: 7400, label: 'נתניה' },
    { id: 70,   label: 'אשדוד' },
    { id: 9000, label: 'באר שבע' },
    { id: 7900, label: 'פתח תקווה' },
    { id: 8600, label: 'רמת גן' },
    { id: 6400, label: 'הרצליה' },
    { id: 6600, label: 'חולון' },
    { id: 8700, label: 'רעננה' },
    { id: 6900, label: 'כפר סבא' },
    { id: 1200, label: 'מודיעין' },
    { id: 650,  label: 'אשקלון' },
    { id: 8400, label: 'רחובות' },
    { id: 6300, label: 'בת ים' },
    { id: 6200, label: 'בני ברק' },
  ]

  readonly roomOptions = [
    { label: '1', val: 1 },
    { label: '1.5', val: 1.5 },
    { label: '2', val: 2 },
    { label: '2.5', val: 2.5 },
    { label: '3', val: 3 },
    { label: '3.5', val: 3.5 },
    { label: '4', val: 4 },
    { label: '4.5', val: 4.5 },
    { label: '5+', val: 5 },
  ]

  // Yad2 property type strings (Hebrew, as stored by scraper)
  readonly propertyTypes = [
    { key: 'דירה',              label: 'דירה' },
    { key: 'דירת גן',           label: 'גן' },
    { key: 'מיני פנטהאוז',      label: 'מיני PH' },
    { key: 'גג/פנטהאוז',        label: 'פנטהאוז' },
    { key: 'דופלקס',            label: 'דופלקס' },
    { key: 'סטודיו/לופט',       label: 'סטודיו' },
    { key: 'בית פרטי/קוטג\'',   label: 'בית פרטי' },
    { key: 'דירה טורית',        label: 'טורית' },
  ]

  readonly freshnessOptions = [
    { label: '24h',    val: 1 },
    { label: '3 days', val: 3 },
    { label: 'Week',   val: 7 },
    { label: 'Month',  val: 30 },
  ]

  ngOnInit() {
    this.api.getCities().subscribe(c => this.cities = c)
  }

  onCityChange() {
    this.neighborhoods = []
    this.params.neighborhoodId = undefined
    if (this.params.cityId) {
      this.api.getNeighborhoods(this.params.cityId).subscribe(n => this.neighborhoods = n)
    }
  }

  selectQuickCity(id: number) {
    this.params.cityId = id
    this.page = 1
    this.onCityChange()
    if (this.mode === 'opportunities') this.loadDeals()
  }

  // Room chips: click once = exact, click again = deselect
  isRoomSelected(val: number): boolean {
    if (val === 5) return this.params.minRooms === 5 && !this.params.maxRooms
    return this.params.minRooms === val && this.params.maxRooms === val
  }

  toggleRoom(val: number) {
    if (this.isRoomSelected(val)) {
      this.params.minRooms = undefined
      this.params.maxRooms = undefined
    } else if (val === 5) {
      this.params.minRooms = 5
      this.params.maxRooms = undefined
    } else {
      this.params.minRooms = val
      this.params.maxRooms = val
    }
  }

  togglePropertyType(key: string) {
    if (this.selectedPropertyTypes.has(key)) {
      this.selectedPropertyTypes.delete(key)
    } else {
      this.selectedPropertyTypes.add(key)
    }
    this.params.propertyTypes = this.selectedPropertyTypes.size
      ? [...this.selectedPropertyTypes].join(',')
      : undefined
  }

  setFreshness(val: number) {
    this.params.maxDays = this.params.maxDays === val ? undefined : val
  }

  setOwnerOnly(on: boolean) {
    this.params.posterType = on ? 'owner' : undefined
  }

  clearAll() {
    this.params = { cityId: this.params.cityId, dealType: this.params.dealType }
    this.selectedPropertyTypes.clear()
  }

  get hasActiveFilters(): boolean {
    return !!(
      this.params.minPrice || this.params.maxPrice ||
      this.params.minPricePerSqm || this.params.maxPricePerSqm ||
      this.params.minSqm || this.params.maxSqm ||
      this.params.minRooms || this.params.maxRooms ||
      this.params.minFloor || this.params.maxFloor ||
      this.params.propertyTypes || this.params.posterType ||
      this.params.maxDays || this.params.neighborhoodId
    )
  }

  switchMode(m: 'search' | 'opportunities' | 'dashboard' | 'about') {
    this.mode = m
    this.listings = []
    this.total = 0
    this.page = 1
    if (m === 'dashboard') this.loadStats()
  }

  loadStats() {
    this.loadingStats = true
    this.api.getStats().subscribe({
      next: s => { this.stats = s; this.loadingStats = false },
      error: () => { this.loadingStats = false },
    })
  }

  classLabel(c: string): string {
    const map: Record<string, string> = {
      deal: 'Deal', below_market: 'Below market', at_market: 'Fair price', overpriced: 'Overpriced',
    }
    return map[c] ?? c
  }

  classColor(c: string): string {
    const map: Record<string, string> = {
      deal: 'green', below_market: 'blue', at_market: 'gray', overpriced: 'red',
    }
    return map[c] ?? 'gray'
  }

  get totalDeals(): number {
    return (this.stats?.distribution.find(d => d.classification === 'deal')?.count ?? 0) +
           (this.stats?.distribution.find(d => d.classification === 'below_market')?.count ?? 0)
  }

  distributionPct(count: number): number {
    const total = this.stats?.totalWithComparisons
    if (!total) return 0
    return Math.round((count / total) * 100)
  }

  loadListings() {
    if (!this.params.cityId) return
    this.api.getListings({ ...this.params, page: this.page }).subscribe(r => {
      this.listings = r.data
      this.total = r.total
    })
  }

  loadDeals() {
    this.api.getDeals({
      cityId:   this.params.cityId || undefined,
      dealType: this.params.dealType,
      minRooms: this.params.minRooms,
      maxRooms: this.params.maxRooms,
      page:     this.page,
    }).subscribe(r => {
      this.listings = r.data
      this.total = r.total
    })
  }

  computeComparisons() {
    this.computingComparisons = true
    this.comparisonStatus = 'Computing…'
    this.api.triggerComparisons().subscribe({
      next: r => {
        this.computingComparisons = false
        this.comparisonStatus = `Done — ${r.processed} listings classified`
        this.loadDeals()
      },
      error: () => {
        this.computingComparisons = false
        this.comparisonStatus = 'Failed'
      },
    })
  }

  scan() {
    if (!this.params.cityId) return
    this.scanning = true
    this.scanStatus = 'Starting scan…'
    this.listings = []
    this.total = 0
    this.api.triggerScan(this.params).subscribe(res => {
      this.jobId = res.jobId
      this.pollSub?.unsubscribe()
      this.pollSub = interval(2000).pipe(
        switchMap(() => this.api.getJob(this.jobId!)),
        takeWhile(job => job.status === 'pending' || job.status === 'running', true),
      ).subscribe(job => {
        if (job.status === 'running')  this.scanStatus = 'Scraping Yad2…'
        if (job.status === 'done') {
          this.scanning = false
          this.scanStatus = `Done — ${job.listingsFound} listings found`
          this.loadListings()
        }
        if (job.status === 'failed') {
          this.scanning = false
          this.scanStatus = `Failed: ${job.error}`
        }
      })
    })
  }

  changePage(p: number) {
    this.page = p
    if (this.mode === 'opportunities') this.loadDeals()
    else this.loadListings()
  }
}
