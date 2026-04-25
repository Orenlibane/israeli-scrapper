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
  cityStats: { cityRaw: string; listingCount: number; avgPriceSqm: number; dealCount: number }[]
  listingsByDay: { date: string; count: number }[]
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

  getStats(params?: { cityId?: number; dealType?: string }): Observable<Stats> {
    const p: Record<string, string> = {}
    if (params?.cityId)   p['cityId']   = String(params.cityId)
    if (params?.dealType) p['dealType'] = params.dealType
    return this.http.get<Stats>(`${API}/api/stats`, { params: p })
  }

  triggerComparisons(): Observable<{ status: string; processed: number; skipped: number }> {
    return this.http.post<{ status: string; processed: number; skipped: number }>(
      `${API}/api/jobs/compute-comparisons`, {}
    )
  }

  triggerTelegram(): Observable<{ status?: string; error?: string }> {
    return this.http.post<{ status?: string; error?: string }>(`${API}/api/jobs/notify-telegram`, {})
  }

  getTelegramStatus(): Observable<{ configured: boolean }> {
    return this.http.get<{ configured: boolean }>(`${API}/api/jobs/telegram-status`)
  }

  getJob(id: string): Observable<Job> {
    return this.http.get<Job>(`${API}/api/jobs/${id}`)
  }

  getProfiles(): Observable<ProfileWithUser[]> {
    return this.http.get<ProfileWithUser[]>(`${API}/api/profiles`)
  }

  updateProfile(id: string, patch: { isActive?: boolean; scanIntervalHours?: number }): Observable<ProfileWithUser> {
    return this.http.patch<ProfileWithUser>(`${API}/api/profiles/${id}`, patch)
  }

  deleteProfile(id: string): Observable<{ deleted: boolean }> {
    return this.http.delete<{ deleted: boolean }>(`${API}/api/profiles/${id}`)
  }

  getAlerts(limit = 50): Observable<RecentAlert[]> {
    return this.http.get<RecentAlert[]>(`${API}/api/alerts`, { params: { limit: String(limit) } })
  }

  sendProfileNow(id: string): Observable<{ queued: boolean }> {
    return this.http.post<{ queued: boolean }>(`${API}/api/profiles/${id}/send-now`, {})
  }

  getGlobalData(): Observable<GlobalData> {
    return this.http.get<GlobalData>(`${API}/api/global-data`)
  }
}

export interface ProfileWithUser {
  id: string
  userId: string
  user: { telegramChatId: string; telegramUsername: string | null; status: string }
  name: string
  cityIds: number[]
  cityNames: string[]
  dealType: string
  minRooms: number | null
  maxRooms: number | null
  maxPrice: number | null
  scanIntervalHours: number
  isActive: boolean
  lastSentAt: string | null
  createdAt: string
  alertCount: number
}

export interface RecentAlert {
  id: string
  alertType: string  // 'new_listing' | 'price_drop' | 'opportunity'
  sentAt: string
  deliveryStatus: string
  user: { telegramUsername: string | null; telegramChatId: string }
  profile: { name: string; dealType: string } | null
  listing: {
    cityRaw: string | null
    priceNis: number
    rooms: number | null
    dealType: string
    sourceUrl: string | null
    propertyType: string | null
  } | null
}

export interface DataSkill {
  name: string
  technique: string
  description: string
  recordsCount: number
  status: 'active' | 'available' | 'planned'
}

export interface GlobalData {
  listingsBySource: { source: string; count: number }[]
  soldTransactions: { total: number; byCity: { cityRaw: string; count: number }[] }
  comparisons: { total: number; soldBacked: number; activeListingBacked: number }
  cityCoverage: { cityRaw: string; listings: number; comparisons: number; soldTx: number }[]
  recentJobs: { id: string; status: string; listingsFound: number; params: unknown; startedAt: string; finishedAt: string | null; error: string | null }[]
  users: { total: number; active: number }
  profiles: { total: number; active: number }
  alerts: { total: number; last24h: number }
  dataSkills: DataSkill[]
}
