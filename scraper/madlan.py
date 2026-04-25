"""
Madlan.co.il listing scraper.
Uses the Madlan GraphQL API (no Cloudflare protection; plain requests library).

Output is normalized to the same format as yad2.py so the same upsertListing
helper in workers.ts can persist both sources without modification.
"""
from __future__ import annotations

import random
import time
from datetime import datetime, timezone
from typing import Any

import requests

GRAPHQL_URL = "https://www.madlan.co.il/api/graphql"
REST_URL = "https://www.madlan.co.il/nadlan/api/listings"
WEB_HOST = "https://www.madlan.co.il"

_DEFAULT_HEADERS = {
    "Accept": "application/json",
    "Content-Type": "application/json",
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Origin": WEB_HOST,
    "Referer": f"{WEB_HOST}/",
    "x-origin": "madlan",
}

# Our DB city IDs — same numeric values Madlan uses for major cities
CITY_IDS = [70, 650, 1200, 3000, 4000, 5000, 6200, 6300, 6400, 6600, 6900, 7400, 7900, 8300, 8400, 8600, 8700, 9000]

CITY_HE: dict[int, str] = {
    5000: "תל אביב יפו",
    3000: "ירושלים",
    4000: "חיפה",
    8300: "ראשון לציון",
    7900: "פתח תקווה",
    70:   "אשדוד",
    7400: "נתניה",
    9000: "באר שבע",
    6600: "חולון",
    6200: "בני ברק",
    8600: "רמת גן",
    6400: "הרצליה",
    6900: "כפר סבא",
    8400: "רחובות",
    1200: "מודיעין מכבים רעות",
    8700: "רעננה",
    650:  "אשקלון",
    6300: "בת ים",
}

_GRAPHQL_QUERY = """
query searchListings($where: ListingSearch!, $pagination: Pagination) {
  listingSearch(where: $where, pagination: $pagination) {
    listings {
      id
      price
      rooms
      squareMeter
      floor
      address { city { text } neighborhood { text } street }
      dealType
      propertyType
      seller { type }
      geolocation { coordinates { lat lon } }
    }
    totalCount
  }
}
""".strip()


def _session() -> requests.Session:
    s = requests.Session()
    s.headers.update(_DEFAULT_HEADERS)
    return s


def _normalize(item: dict[str, Any], city_id: int, deal_type: str) -> dict[str, Any] | None:
    """Convert a raw Madlan API item to our standard listing dict."""
    listing_id_raw = item.get("id")
    if not listing_id_raw:
        return None

    addr = item.get("address") or {}
    city_obj = addr.get("city") or {}
    neighborhood_obj = addr.get("neighborhood") or {}
    street_raw = addr.get("street")

    city = city_obj.get("text") or CITY_HE.get(city_id)
    neighborhood = neighborhood_obj.get("text") if isinstance(neighborhood_obj, dict) else None

    price_raw = item.get("price")
    try:
        price = int(price_raw) if price_raw is not None else 0
    except (ValueError, TypeError):
        price = 0

    rooms_raw = item.get("rooms")
    try:
        rooms = float(rooms_raw) if rooms_raw is not None else None
    except (ValueError, TypeError):
        rooms = None

    sqm_raw = item.get("squareMeter")
    try:
        area = float(sqm_raw) if sqm_raw is not None else None
    except (ValueError, TypeError):
        area = None

    floor_raw = item.get("floor")
    try:
        floor = int(floor_raw) if floor_raw is not None else None
    except (ValueError, TypeError):
        floor = None

    price_per_sqm = round(price / area) if price and area else None

    # Geolocation
    geo = item.get("geolocation") or {}
    coords = (geo.get("coordinates") or {})
    lat = coords.get("lat")
    lon = coords.get("lon")

    # Seller / poster type
    seller = item.get("seller") or {}
    seller_type = seller.get("type", "").lower() if isinstance(seller, dict) else ""
    poster_type = "owner" if seller_type in ("private", "owner") else "agent"

    # Deal type normalisation
    raw_deal = (item.get("dealType") or "").upper()
    if raw_deal == "FORSALE":
        norm_deal = "sale"
    elif raw_deal == "RENT":
        norm_deal = "rent"
    else:
        norm_deal = "sale" if deal_type in ("forsale", "sale") else "rent"

    property_type = item.get("propertyType") or "דירה"

    now = datetime.now(timezone.utc).isoformat()

    return {
        "listing_id":    f"madlan:{listing_id_raw}",
        "source_site":   "madlan",
        "source_url":    f"{WEB_HOST}/listing/{listing_id_raw}",
        "price_nis":     price,
        "price_per_sqm": price_per_sqm,
        "deal_type":     norm_deal,
        "property_type": property_type,
        "rooms":         rooms,
        "area_sqm":      area,
        "floor":         floor,
        "city":          city,
        "neighborhood":  neighborhood,
        "street":        street_raw,
        "lat":           lat,
        "lon":           lon,
        "poster_type":   poster_type,
        "published_at":  None,
        "first_seen":    now,
        "last_seen":     now,
    }


def _scrape_graphql(
    session: requests.Session,
    city_id: int,
    deal_type: str,
    max_pages: int,
    rate_s: float,
) -> list[dict[str, Any]]:
    """Try GraphQL API. Returns list of normalized listings (may be empty on failure)."""
    madlan_deal = "FORSALE" if deal_type in ("forsale", "sale") else "RENT"
    results: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    page_size = 50

    for page in range(1, max_pages + 1):
        payload = {
            "query": _GRAPHQL_QUERY,
            "variables": {
                "where": {
                    "cityId": str(city_id),
                    "dealType": madlan_deal,
                },
                "pagination": {
                    "page": page,
                    "size": page_size,
                },
            },
        }

        try:
            r = session.post(GRAPHQL_URL, json=payload, timeout=20)
        except Exception as e:
            print(f"[madlan] GraphQL request error page {page}: {e}", flush=True)
            break

        if r.status_code not in (200,):
            print(f"[madlan] GraphQL HTTP {r.status_code} page {page}: {r.text[:200]}", flush=True)
            break

        try:
            data = r.json()
        except Exception:
            print(f"[madlan] GraphQL non-JSON page {page}", flush=True)
            break

        if "errors" in data:
            print(f"[madlan] GraphQL errors page {page}: {data['errors']}", flush=True)
            break

        search = (data.get("data") or {}).get("listingSearch") or {}
        items = search.get("listings") or []
        total_count = search.get("totalCount") or 0

        if page == 1:
            total_pages = min(max_pages, -(-total_count // page_size))  # ceil division
            print(
                f"[madlan] city={city_id} total={total_count} pages≈{total_pages} (fetching up to {max_pages})",
                flush=True,
            )

        new_count = 0
        for item in items:
            raw_id = item.get("id")
            if not raw_id or raw_id in seen_ids:
                continue
            seen_ids.add(raw_id)
            norm = _normalize(item, city_id, deal_type)
            if norm:
                results.append(norm)
                new_count += 1

        print(f"[madlan] GraphQL page {page}: {len(items)} items, +{new_count} new (total {len(results)})", flush=True)

        # Stop if we've seen all items or there are none
        if not items or len(results) >= total_count:
            break

        if page < max_pages:
            time.sleep(rate_s + random.uniform(0, 1.0))

    return results


def _scrape_rest(
    session: requests.Session,
    city_id: int,
    deal_type: str,
    max_pages: int,
    rate_s: float,
) -> list[dict[str, Any]]:
    """Fallback REST endpoint. Returns list of normalized listings (may be empty on failure)."""
    rest_deal = "forsale" if deal_type in ("forsale", "sale") else "rent"
    results: list[dict[str, Any]] = []
    seen_ids: set[str] = set()

    for page in range(1, max_pages + 1):
        params = {
            "cityId": city_id,
            "dealType": rest_deal,
            "page": page,
        }

        try:
            r = session.get(REST_URL, params=params, timeout=20)
        except Exception as e:
            print(f"[madlan] REST request error page {page}: {e}", flush=True)
            break

        if r.status_code not in (200,):
            print(f"[madlan] REST HTTP {r.status_code} page {page}: {r.text[:200]}", flush=True)
            break

        try:
            data = r.json()
        except Exception:
            print(f"[madlan] REST non-JSON page {page}", flush=True)
            break

        # REST may return a list or a dict with a "listings" key
        if isinstance(data, list):
            items = data
        elif isinstance(data, dict):
            items = data.get("listings") or data.get("items") or []
        else:
            items = []

        if page == 1:
            print(f"[madlan] REST city={city_id} page 1 returned {len(items)} items", flush=True)

        if not items:
            break

        new_count = 0
        for item in items:
            raw_id = item.get("id")
            if not raw_id or raw_id in seen_ids:
                continue
            seen_ids.add(raw_id)
            norm = _normalize(item, city_id, deal_type)
            if norm:
                results.append(norm)
                new_count += 1

        print(f"[madlan] REST page {page}: {len(items)} items, +{new_count} new (total {len(results)})", flush=True)

        if page < max_pages:
            time.sleep(rate_s + random.uniform(0, 1.0))

    return results


def scrape(
    city_id: int,
    deal_type: str = "forsale",
    max_pages: int = 20,
    rate_s: float = 1.5,
) -> list[dict[str, Any]]:
    """
    Scrape Madlan listings for a given city and deal type.

    Tries GraphQL first; falls back to REST if GraphQL returns nothing.
    Never raises — returns [] on total failure.
    """
    if city_id not in CITY_HE:
        print(f"[madlan] Unknown city_id={city_id}.", flush=True)
        return []

    session = _session()

    try:
        results = _scrape_graphql(session, city_id, deal_type, max_pages, rate_s)
    except Exception as e:
        print(f"[madlan] GraphQL scrape exception for city={city_id}: {e}", flush=True)
        results = []

    if not results:
        print(f"[madlan] GraphQL returned 0 results for city={city_id} — trying REST fallback", flush=True)
        try:
            results = _scrape_rest(session, city_id, deal_type, max_pages, rate_s)
        except Exception as e:
            print(f"[madlan] REST fallback exception for city={city_id}: {e}", flush=True)
            results = []

    print(f"[madlan] city={city_id} deal={deal_type} → {len(results)} listings total", flush=True)
    return results
