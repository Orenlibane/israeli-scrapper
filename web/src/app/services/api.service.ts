import { Injectable, inject } from '@angular/core'
import { HttpClient } from '@angular/common/http'
import { Observable } from 'rxjs'
import { environment } from '../../environments/environment'

export interface City { id: number; name: string; nameHe: string }
export interface Neighborhood { id: number; name: string; nameHe: string; cityId: number }

export interface Comparison {
  classification:    string   // 'deal' | 'below_market' | 'at_market' | 'overpriced'
  pctDiff:           number   // negative = below market
  avgPricePerSqm:    number
  medianPricePerSqm: number
  numTransactions:   number   // comparable listings used in benchmark
  benchmarkSource:   string   // 'sold_transactions' | 'active_listings'
  soldComparables:   number
  computedAt?:       string
}

export interface Listing {
  id: string; source: string; sourceUrl: string | null
  priceNis: number; pricePerSqm: number | null; dealType: string
  propertyType: string | null; rooms: number | null; areaSqm: number | null
  floor: number | null; cityRaw: string | null; neighborhoodRaw: string | null
  street: string | null; posterType: string | null
  firstSeenAt: string; daysOnMarket: number
  comparison: Comparison | null
}

export interface ListingsResponse { total: number; page: number; pageSize: number; data: Listing[] }

export interface Stats {
  totalListings: number
  totalWithComparisons: number
  recentListings: number
  distribution: { classification: string; count: number }[]
  topDealCities: { cityRaw: string; dealCount: number; avgDiscount: number; avgDaysListed: number }[]
}

export interface ScanParams {
  cityId: number
  neighborhoodId?: number
  dealType: string
  // Price
  minPrice?: number
  maxPrice?: number
  minPricePerSqm?: number
  maxPricePerSqm?: number
  // Size
  minSqm?: number
  maxSqm?: number
  // Rooms
  minRooms?: number
  maxRooms?: number
  // Floor
  minFloor?: number
  maxFloor?: number
  // Property & poster type
  propertyTypes?: string    // comma-separated
  posterType?: string       // 'owner' | 'agent'
  // Freshness
  maxDays?: number
}

export interface Job {
  id: string; status: string; listingsFound: number
  error: string | null; startedAt: string; finishedAt: string | null
}

const API = environment.apiUrl

@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient)

  getCities(): Observable<City[]> {
    return this.http.get<City[]>(`${API}/api/cities`)
  }

  getNeighborhoods(cityId: number): Observable<Neighborhood[]> {
    return this.http.get<Neighborhood[]>(`${API}/api/cities/${cityId}/neighborhoods`)
  }

  getListings(params: Partial<ScanParams> & { page?: number }): Observable<ListingsResponse> {
    const p: Record<string, string> = {}
    Object.entries(params).forEach(([k, v]) => { if (v != null) p[k] = String(v) })
    return this.http.get<ListingsResponse>(`${API}/api/listings`, { params: p })
  }

  getDeals(params: { cityId?: number; dealType?: string; minRooms?: number; maxRooms?: number; page?: number }): Observable<ListingsResponse> {
    const p: Record<string, string> = {}
    Object.entries(params).forEach(([k, v]) => { if (v != null) p[k] = String(v) })
    return this.http.get<ListingsResponse>(`${API}/api/deals`, { params: p })
  }

  triggerScan(params: ScanParams): Observable<{ jobId: string; status: string }> {
    return this.http.post<{ jobId: string; status: string }>(`${API}/api/jobs/scan`, params)
  }

  getStats(): Observable<Stats> {
    return this.http.get<Stats>(`${API}/api/stats`)
  }

  triggerComparisons(): Observable<{ status: string; processed: number; skipped: number }> {
    return this.http.post<{ status: string; processed: number; skipped: number }>(
      `${API}/api/jobs/compute-comparisons`, {}
    )
  }

  getJob(id: string): Observable<Job> {
    return this.http.get<Job>(`${API}/api/jobs/${id}`)
  }
}
