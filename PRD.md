# Israeli Real Estate Alert Bot — Product Requirements Document

> Converted from original Hebrew spec. WhatsApp replaced with Telegram per product decision.

---

## 1. Executive Summary

A bot that scrapes Israeli real estate listings X times per day based on user-defined search profiles. It identifies new listings, price changes, and opportunities, then delivers targeted Telegram alerts. A scoring engine ranks listings against actual sold transactions from the area to classify whether a listing is above/below market price.

---

## 2. Business Goals

- Surface relevant listings quickly — reduce manual search time
- Identify properties with attractive price-per-sqm
- Track price drops and listings that have been sitting for too long
- Compare asking price to actual sold transactions in the same area

---

## 3. Tech Stack (Decided)

| Layer | Technology | Reason |
|-------|-----------|--------|
| Backend | Node.js + Fastify | User preference, unified ecosystem with Angular |
| Scraping | axios + Playwright (fallback) | Use internal JSON/GraphQL APIs first; Playwright only for anti-bot fallback |
| Queue / Scheduler | Bull Queue + Redis | Job scheduling per user profile |
| Database | PostgreSQL | Relational, strong for complex queries |
| ORM | Prisma | Type-safe, great Railway integration |
| Telegram | grammY | Latest Bot API v9.5, TypeScript-first, best plugin ecosystem |
| Frontend | Angular | Admin UI + user onboarding |
| Hosting | Railway | All services (API, worker, Postgres, Redis) |
| Monitoring | Railway logs + Grafana/Prometheus | Observability stack |

---

## 4. Data Sources

| Source | Type | Approach | Difficulty |
|--------|------|----------|------------|
| Yad2 (יד2) | Listings | Internal JSON API via axios + curl_cffi TLS impersonation | Hard (Cloudflare) |
| Madlan (מדלן) | Listings + price history | GraphQL API | Medium (rate limits) |
| nadlan.gov.il | Sold transactions | Official REST API | Easy (rate limits only) |
| Homeless / Komo | Listings | Next.js `_next/data` sidecar | Easy-Medium |

**MVP: Start with Yad2 + nadlan.gov.il only.** Add Madlan in Phase 2.

---

## 5. Architecture

```
┌─────────────────────────────────────────────────────┐
│                     Railway Project                  │
│                                                      │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────┐  │
│  │  API Server │  │   Worker     │  │  Angular   │  │
│  │  (Fastify)  │  │ (Bull Queue) │  │  Admin UI  │  │
│  └──────┬──────┘  └──────┬───────┘  └────────────┘  │
│         │                │                           │
│  ┌──────▼────────────────▼──────┐                    │
│  │         PostgreSQL           │                    │
│  └──────────────────────────────┘                    │
│  ┌──────────────────────────────┐                    │
│  │           Redis              │                    │
│  └──────────────────────────────┘                    │
└─────────────────────────────────────────────────────┘
         │                    │
         ▼                    ▼
   Telegram API         Data Sources
   (grammY)         (Yad2, nadlan.gov.il)
```

### Services

| Service | Role |
|---------|------|
| API Server (Fastify) | User management, search profiles, webhook endpoint for Telegram |
| Worker (Bull Queue) | Runs scheduled scrape jobs per user profile |
| Collectors | Per-source scraping modules (Yad2, Madlan, nadlan.gov.il) |
| Normalization Engine | Unified listing schema across sources |
| Deduplication Engine | Detect duplicate/reposted listings |
| Valuation Engine | Price/sqm calc, days-on-market, comparison to sold transactions |
| Alert Decision Engine | Rules engine — decides when to fire an alert |
| Telegram Delivery Service | grammY bot, message templates, delivery logging |

---

## 6. Data Model

### Core Tables

```sql
users
  id, telegram_chat_id, telegram_username, phone, status, created_at, quiet_hours_start, quiet_hours_end

search_profiles
  id, user_id, name, cities[], neighborhoods[], min_price, max_price, min_sqm, max_sqm,
  max_price_per_sqm, min_rooms, max_rooms, floor_min, floor_max, has_elevator, has_parking,
  has_balcony, scan_times_per_day, alert_mode (immediate|daily_summary), is_active, paused_at

listings
  id, source, source_id, url, title, price, sqm, rooms, floor, city, neighborhood,
  description, published_at, first_seen_at, last_seen_at, status (active|removed|changed)

listing_history
  id, listing_id, field_changed, old_value, new_value, detected_at

sold_transactions
  id, address, lat, lng, price, sqm, price_per_sqm, rooms, transaction_date, source, confidence

listing_comparisons
  id, listing_id, profile_id, reference_metric, num_transactions, pct_diff, classification
  (deal|below_market|at_market|overpriced), computed_at

alerts
  id, user_id, listing_id, profile_id, alert_type (new|price_drop|returned|long_on_market|opportunity),
  message_text, sent_at, delivery_status

jobs
  id, profile_id, started_at, finished_at, status, listings_found, alerts_sent, error_log
```

---

## 7. Telegram Bot — User Flow

### Setup (6 steps via bot commands)
1. `/start` → welcome + language choice
2. `/newprofile` → choose city
3. → choose neighborhoods
4. → set price range + sqm range
5. → set scans per day (2/4/8)
6. → set alert mode (immediate / daily summary)
7. Confirmation message sent → profile active

### Alert Message Format

```
🏠 New Listing | Tel Aviv, Florentin
💰 2,950,000 ₪ | 78 m² | 37,821 ₪/m²
🛏 3 rooms | Floor 2
📅 3 days on market

📊 Market comparison (6 transactions, 12 months):
   Area avg: 33,500 ₪/m² | Gap: -7.5% → Below Market

🏷 Tags: NEW • BELOW MARKET
🔗 View listing: <link>
```

### Bot Commands
- `/myprofiles` — list active profiles
- `/pause [profile]` — pause a profile
- `/resume [profile]` — resume a profile
- `/delete [profile]` — delete a profile
- `/summary` — get today's summary now
- `/stop` — unsubscribe from all alerts

---

## 8. Alert Decision Rules

### Hard filters (must match all)
- City / neighborhood in profile
- Price within range
- sqm within range
- Rooms within range (if set)

### Alert triggers
| Trigger | Condition |
|---------|-----------|
| New listing | Never seen before, passes hard filters |
| Price drop | Price decreased vs last snapshot |
| Returned listing | Listing disappeared then came back |
| Long on market | Active > 45 days + passes filters |
| Opportunity | Below-market classification + score threshold |

### Scoring (0–100, used for sorting only — not a hard filter)
| Factor | Weight |
|--------|--------|
| Price/sqm vs user's max | 40% |
| Listing freshness | 20% |
| Price drop detected | 20% |
| Days on market | 10% |
| Feature match | 10% |

### Market Classification (requires ≥ 3 comparable transactions)
| Classification | Condition |
|----------------|-----------|
| Deal (מציאה) | > 10% below area median |
| Below Market | 5–10% below |
| At Market | ±5% |
| Overpriced | > 5% above |

---

## 9. Functional Requirements

### 9.1 Search Profile Management
- Multiple cities + neighborhoods per profile
- Price range, sqm range, price/sqm max
- Rooms, floor, elevator, parking, balcony filters
- Pause / resume / delete profile
- Quiet hours (no alerts during defined window)

### 9.2 Monitoring Frequency
- User sets: 2x / 4x / 8x per day
- Jobs distributed evenly across the day
- Manual trigger available from admin UI

### 9.3 Listing Analysis
- Price/sqm = total price ÷ sqm
- Days on market = today − first_seen_at
- Change detection: price, text, status
- Deduplication: cross-source and repost detection

### 9.4 Delivery
- Immediate alert per event
- Optional daily summary (morning)
- Retry on Telegram delivery failure (3x with backoff)
- Delivery log with provider response

### 9.5 Admin UI (Angular)
- Active users + profiles
- Data sources health + last run
- Job run history
- Alerts sent / delivery failures
- Manual scan trigger per profile

---

## 10. Non-Functional Requirements

- High availability for scan + delivery pipeline
- Support 100s–1000s of search profiles
- Retry logic on scraping and delivery failures
- Full logging: scans, alerts, errors
- Encrypted storage of user phone numbers
- Rate-limit-aware per data source (per-site throttling)
- Graceful source blocking if error rate spikes

---

## 11. Implementation Phases

### Phase 1 — MVP ✳️ (current target)
- [ ] Yad2 scraper (internal JSON API)
- [ ] nadlan.gov.il sold transactions fetcher
- [ ] Basic Telegram bot (setup flow, alerts, /stop)
- [ ] 1 search profile per user
- [ ] New listing + price drop alerts
- [ ] Price/sqm + days on market calculation
- [ ] PostgreSQL schema + Prisma
- [ ] Bull Queue scheduler
- [ ] Railway deployment (API + worker + Postgres + Redis)
- [ ] Basic job logging

### Phase 2
- [ ] Madlan scraper
- [ ] Multiple profiles per user
- [ ] Opportunity score + market comparison
- [ ] Address normalization + geo proximity
- [ ] Daily summary mode
- [ ] Duplicate detection (cross-source)

### Phase 3
- [ ] Angular admin UI
- [ ] Full observability (Grafana + Prometheus)
- [ ] Neighborhood market analytics
- [ ] Source blocklist auto-management
- [ ] Returned listing detection

### Phase 4
- [ ] Homeless / Komo scrapers
- [ ] Scale optimization
- [ ] Advanced template management
- [ ] User-facing settings UI (Telegram Mini App)

---

## 12. Open Questions

1. Which Yad2 neighborhoods to support first? (need Hebrew neighborhood codes)
2. Minimum score threshold for "opportunity" alerts — or send all that pass hard filters?
3. Daily summary — morning only, or configurable time?
4. Self-service signup or admin-approved?
5. Multi-user from day 1 or single-user MVP first?
6. Rental monitoring in scope eventually?

---

## 13. Skills Available for This Project

| Skill | Coverage |
|-------|----------|
| `israeli-nadlan-scraper` | Yad2, Madlan, nadlan.gov.il API patterns, anti-bot, unified schema |
| `israeli-real-estate` | Domain knowledge, Hebrew city/neighborhood codes |
| `israeli-real-estate-data-sources` | Source selection, legal considerations |
| `address-normalization-hebrew` | Hebrew address parsing + normalization |
| `deduplication-engine` | Cross-source listing deduplication |
| `telegram-bot-builder` | grammY setup, webhooks, Hebrew RTL, templates |
| `railway-deployment` | Service config, Postgres/Redis, Nixpacks, env vars |
| `testing-suite` | Unit + integration test setup |
| `observability-stack` | Logging, metrics, alerting |
| `schedule` | Cron / queue patterns |
| `rules-engine-patterns` | Alert decision engine design |
| `playwright-browser-automation` | Browser fallback for anti-bot sites |

### Gaps (no skill covers these)
| Gap | Mitigation |
|-----|-----------|
| Angular frontend | Standard Angular docs + general patterns |
| Geocoding / geo proximity | Use OpenStreetMap Nominatim API (free) or Google Maps API |
| Yad2 TLS bypass in Node.js | Python microservice via `curl_cffi`, or use `curl-impersonate` in Node |
