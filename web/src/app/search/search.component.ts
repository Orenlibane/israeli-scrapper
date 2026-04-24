import { Component, OnInit, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { interval, Subscription } from 'rxjs'
import { switchMap, takeWhile } from 'rxjs/operators'
import { ApiService, City, Neighborhood, Listing, ScanParams } from '../services/api.service'
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

  loadListings() {
    if (!this.params.cityId) return
    this.api.getListings({ ...this.params, page: this.page }).subscribe(r => {
      this.listings = r.data
      this.total = r.total
    })
  }

  scan() {
    if (!this.params.cityId) return
    this.scanning = true
    this.scanStatus = 'Starting scan...'
    this.api.triggerScan(this.params).subscribe(res => {
      this.jobId = res.jobId
      this.pollSub?.unsubscribe()
      this.pollSub = interval(2000).pipe(
        switchMap(() => this.api.getJob(this.jobId!)),
        takeWhile(job => job.status === 'pending' || job.status === 'running', true),
      ).subscribe(job => {
        if (job.status === 'running')  this.scanStatus = 'Scraping Yad2...'
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
    this.loadListings()
  }
}
