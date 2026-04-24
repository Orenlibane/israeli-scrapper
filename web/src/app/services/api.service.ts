import { Injectable, inject } from '@angular/core'
import { HttpClient } from '@angular/common/http'
import { Observable } from 'rxjs'

export interface City { id: number; name: string; nameHe: string }
export interface Neighborhood { id: number; name: string; nameHe: string; cityId: number }
export interface Comparison { classification: string; pctDiff: number; avgPricePerSqm: number; numTransactions: number }
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
export interface ScanParams {
  cityId: number; neighborhoodId?: number; dealType: string
  minPrice?: number; maxPrice?: number; minSqm?: number; maxSqm?: number
  minRooms?: number; maxRooms?: number
}
export interface Job { id: string; status: string; listingsFound: number; error: string | null; startedAt: string; finishedAt: string | null }

const API = 'http://localhost:3000'

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

  triggerScan(params: ScanParams): Observable<{ jobId: string; status: string }> {
    return this.http.post<{ jobId: string; status: string }>(`${API}/api/jobs/scan`, params)
  }

  getJob(id: string): Observable<Job> {
    return this.http.get<Job>(`${API}/api/jobs/${id}`)
  }
}
