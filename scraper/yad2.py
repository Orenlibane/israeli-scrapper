"""
Yad2 listing scraper.
Uses curl_cffi with Chrome TLS impersonation to bypass Cloudflare + ShieldSquare.
"""
from __future__ import annotations

import random
import re
import time
from datetime import datetime, timezone
from typing import Any, Iterator

try:
    from curl_cffi import requests as cc
except ImportError as e:
    raise ImportError("pip install curl_cffi") from e

API_HOST  = "https://gw.yad2.co.il"
WEB_HOST  = "https://www.yad2.co.il"
PROFILES  = ["chrome120", "chrome124", "chrome131", "safari17_0"]

_DEFAULT_HEADERS = {
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "he-IL,he;q=0.9,en-US;q=0.8",
    "Referer": f"{WEB_HOST}/",
    "Origin": WEB_HOST,
}


def _session(profile: str = "chrome120") -> cc.Session:
    s = cc.Session()
    s.headers.update(_DEFAULT_HEADERS)
    s._profile = profile
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
    item_id = item.get("id") or item.get("token")
    coords  = item.get("coordinates") or {}
    customer = item.get("customer") or {}
    poster_type = "agent" if (item.get("merchant") or customer.get("agency_name")) else "owner"
    row2 = item.get("row_2") or ""
    city  = row2.split(",")[0].strip() or None
    nbhd  = row2.split(",", 1)[1].strip() if "," in row2 else None
    now   = datetime.now(timezone.utc).isoformat()

    price = _norm_price(item.get("price"))
    area  = float(item["square_meter"]) if item.get("square_meter") else None
    price_per_sqm = round(price / area) if price and area else None

    return {
        "listing_id": f"yad2:{item_id}",
        "source_site": "yad2",
        "source_url": f"{WEB_HOST}/item/{item_id}" if item_id else None,
        "price_nis": price,
        "price_per_sqm": price_per_sqm,
        "price_type": "asking_rent" if deal_type == "rent" else "asking_sale",
        "deal_type": "rent" if deal_type == "rent" else "sale",
        "property_type": item.get("HomeTypeID_text") or "apartment",
        "rooms": _norm_rooms(item.get("rooms")),
        "area_sqm": area,
        "floor": int(item["floor"]) if str(item.get("floor", "")).isdigit() else None,
        "city": city,
        "neighborhood": nbhd,
        "street": item.get("row_3"),
        "lat": coords.get("latitude"),
        "lon": coords.get("longitude"),
        "poster_type": poster_type,
        "published_at": item.get("date_added"),
        "first_seen": now,
        "last_seen": now,
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
    top_area: int | None = None,
    max_pages: int = 20,
    rate_s: float = 3.0,
) -> list[dict[str, Any]]:
    """Scrape Yad2 listings for a city/neighborhood with optional filters."""

    params: dict[str, Any] = {"city": city_id, "property": "1"}
    if neighborhood_id:
        params["neighborhood"] = neighborhood_id
    if top_area:
        params["topArea"] = top_area
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

    session  = _session()
    results: list[dict[str, Any]] = []

    for page in range(1, max_pages + 1):
        params["page"] = page
        from urllib.parse import urlencode
        url = f"{API_HOST}/realestate-feed/{deal_type}/map?{urlencode(params)}"

        try:
            r = session.get(url, impersonate=session._profile, timeout=20)
        except Exception as e:
            print(f"[yad2] Request error on page {page}: {e}", flush=True)
            break

        if r.status_code == 403:
            print(f"[yad2] 403 — Cloudflare block on page {page}. Try switching profile.", flush=True)
            break
        if r.status_code != 200:
            print(f"[yad2] HTTP {r.status_code} on page {page}", flush=True)
            break

        try:
            payload = r.json()
        except Exception:
            print(f"[yad2] Non-JSON response on page {page} (anti-bot page?)", flush=True)
            break

        feed  = (payload.get("data") or {}).get("feed") or {}
        items = feed.get("feed_items") or []
        if not items:
            break

        for raw in items:
            if not (raw.get("id") or raw.get("token")):
                continue
            results.append(_normalize(raw, deal_type))

        total_pages = feed.get("total_pages") or 1
        print(f"[yad2] Page {page}/{min(total_pages, max_pages)}: +{len(items)} listings", flush=True)

        if page >= min(total_pages, max_pages):
            break

        time.sleep(rate_s + random.uniform(0, 1.0))

    return results
