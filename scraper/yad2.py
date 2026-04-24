"""
Yad2 listing scraper.
Uses curl_cffi with Chrome TLS impersonation to bypass Cloudflare.

Uses the /feed endpoint (not /map) which returns all paginated listings.
Map endpoint only shows ~200 clustered markers per page; feed shows all listings.
"""
from __future__ import annotations

import random
import re
import time
from datetime import datetime, timezone
from typing import Any

try:
    from curl_cffi import requests as cc
except ImportError as e:
    raise ImportError("pip install curl_cffi") from e

API_HOST = "https://gw.yad2.co.il"
WEB_HOST = "https://www.yad2.co.il"

_DEFAULT_HEADERS = {
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "he-IL,he;q=0.9,en-US;q=0.8",
    "Referer": f"{WEB_HOST}/",
    "Origin": WEB_HOST,
}

# Maps our DB city IDs to (yad2_city_id, area_id, region_id).
# city/area/region IDs verified via Yad2 autocomplete API.
# Note: Yad2 city IDs differ from our DB city IDs in some cases.
CITY_MAP: dict[int, tuple[str, int, int]] = {
    5000: ("5000", 1,  3),   # Tel Aviv
    3000: ("3000", 7,  6),   # Jerusalem
    4000: ("4000", 5,  5),   # Haifa
    8300: ("8300", 9,  1),   # Rishon LeZion
    7900: ("7900", 4,  1),   # Petah Tikva
    70:   ("0070", 21, 2),   # Ashdod (DB=70, Yad2=0070)
    7400: ("7400", 17, 1),   # Netanya
    9000: ("9000", 22, 2),   # Beer Sheva
    6600: ("6600", 11, 3),   # Holon
    6200: ("6100", 78, 1),   # Bnei Brak (DB=6200, Yad2=6100)
    8600: ("8600", 3,  3),   # Ramat Gan
    6400: ("6400", 18, 1),   # Herzliya
    6900: ("6900", 42, 1),   # Kfar Saba
    8400: ("8400", 12, 1),   # Rehovot
    1200: ("1200", 8,  1),   # Modi'in
    8700: ("8700", 42, 1),   # Ra'anana
    650:  ("7100", 21, 2),   # Ashkelon (DB=650, Yad2=7100)
    6300: ("6200", 11, 3),   # Bat Yam (DB=6300, Yad2=6200)
}


def _session() -> cc.Session:
    s = cc.Session()
    s.headers.update(_DEFAULT_HEADERS)
    return s


def _norm_price(raw: Any) -> int:
    if raw is None:
        return 0
    if isinstance(raw, (int, float)):
        return int(raw)
    digits = re.sub(r"[^\d]", "", str(raw))
    return int(digits) if digits else 0


def _norm_rooms(raw: Any) -> float | None:
    if raw is None:
        return None
    if isinstance(raw, (int, float)):
        return float(raw)
    s = str(raw).strip()
    m = re.match(r"^([\d.]+)\s*-\s*([\d.]+)", s)
    if m:
        return (float(m.group(1)) + float(m.group(2))) / 2
    m = re.match(r"^([\d.]+)", s)
    return float(m.group(1)) if m else None


def _normalize(item: dict[str, Any], deal_type: str) -> dict[str, Any]:
    addr    = item.get("address") or {}
    coords  = addr.get("coords") or {}
    details = item.get("additionalDetails") or {}
    prop    = details.get("property") or {}
    house   = addr.get("house") or {}

    city         = (addr.get("city") or {}).get("text")
    neighborhood = (addr.get("neighborhood") or {}).get("text")
    street       = (addr.get("street") or {}).get("text")
    floor_raw    = house.get("floor")

    token = item.get("token")
    price = _norm_price(item.get("price"))
    rooms = _norm_rooms(details.get("roomsCount"))
    area  = float(details["squareMeter"]) if details.get("squareMeter") else None

    price_per_sqm = round(price / area) if price and area else None
    poster_type   = "owner" if item.get("adType") == "private" else "agent"
    now           = datetime.now(timezone.utc).isoformat()

    return {
        "listing_id":    f"yad2:{token}",
        "source_site":   "yad2",
        "source_url":    f"{WEB_HOST}/item/{token}" if token else None,
        "price_nis":     price,
        "price_per_sqm": price_per_sqm,
        "deal_type":     "rent" if deal_type == "rent" else "sale",
        "property_type": prop.get("text") or "דירה",
        "rooms":         rooms,
        "area_sqm":      area,
        "floor":         int(floor_raw) if floor_raw is not None else None,
        "city":          city,
        "neighborhood":  neighborhood,
        "street":        street,
        "lat":           coords.get("lat"),
        "lon":           coords.get("lon"),
        "poster_type":   poster_type,
        "published_at":  None,
        "first_seen":    now,
        "last_seen":     now,
    }


def scrape(
    city_id: int,
    neighborhood_id: int | None = None,
    deal_type: str = "forsale",
    min_price: int | None = None,
    max_price: int | None = None,
    min_sqm: int | None = None,
    max_sqm: int | None = None,
    min_rooms: float | None = None,
    max_rooms: float | None = None,
    max_pages: int = 20,
    rate_s: float = 2.0,
) -> list[dict[str, Any]]:
    """Scrape Yad2 listings using the /feed endpoint (all paginated listings)."""

    city_info = CITY_MAP.get(city_id)
    if not city_info:
        print(f"[yad2] Unknown city_id={city_id}.", flush=True)
        return []

    yad2_city_id, area_id, region_id = city_info

    params: dict[str, Any] = {
        "city":   yad2_city_id,
        "area":   area_id,
        "region": region_id,
    }
    if neighborhood_id:
        params["neighborhood"] = neighborhood_id
    if min_price or max_price:
        lo = min_price or -1
        hi = max_price or -1
        params["price"] = f"{lo}-{hi}"
    if min_sqm or max_sqm:
        lo = min_sqm or -1
        hi = max_sqm or -1
        params["squaremeter"] = f"{lo}-{hi}"
    if min_rooms or max_rooms:
        lo = min_rooms or ""
        hi = max_rooms or ""
        params["rooms"] = f"{lo}-{hi}" if (lo and hi) else str(lo or hi)

    yad2_deal = "rent" if deal_type == "rent" else "forsale"
    session   = _session()
    results:  list[dict[str, Any]] = []
    seen_tokens: set[str] = set()
    total_pages = max_pages  # will be updated from first response

    for page in range(1, max_pages + 1):
        params["page"] = page
        from urllib.parse import urlencode
        url = f"{API_HOST}/realestate-feed/{yad2_deal}/feed?{urlencode(params)}"

        try:
            r = session.get(url, impersonate="chrome120", timeout=20)
        except Exception as e:
            print(f"[yad2] Request error page {page}: {e}", flush=True)
            break

        if r.status_code == 403:
            print(f"[yad2] 403 page {page} — Cloudflare block.", flush=True)
            break
        if r.status_code not in (200,):
            print(f"[yad2] HTTP {r.status_code} page {page}: {r.text[:200]}", flush=True)
            break

        try:
            payload = r.json()
        except Exception:
            print(f"[yad2] Non-JSON page {page}", flush=True)
            break

        data = payload.get("data") or {}

        # Update total pages from first response
        if page == 1:
            pagination = data.get("pagination") or {}
            server_pages = pagination.get("totalPages", max_pages)
            total_pages = min(server_pages, max_pages)
            total_listings = pagination.get("total", "?")
            print(f"[yad2] city={yad2_city_id} total={total_listings} pages={server_pages} (fetching {total_pages})", flush=True)

        # Combine private + agency listings (feed splits them)
        items = list(data.get("private") or []) + list(data.get("agency") or [])

        new_count = 0
        for item in items:
            token = item.get("token")
            if not token or token in seen_tokens:
                continue
            seen_tokens.add(token)
            results.append(_normalize(item, deal_type))
            new_count += 1

        print(f"[yad2] page {page}/{total_pages}: {len(items)} items, +{new_count} new (total {len(results)})", flush=True)

        if page >= total_pages:
            break

        if page < total_pages:
            time.sleep(rate_s + random.uniform(0, 1.0))

    return results
