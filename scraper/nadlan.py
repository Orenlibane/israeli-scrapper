"""
nadlan.gov.il transaction fetcher.
Uses Playwright to manage the full browser session, then calls the nadlan REST
API via page.evaluate() so all requests carry the browser's JS-managed session
tokens (CSRF, Angular auth headers, etc.) that httpx alone cannot replicate.
"""
from __future__ import annotations

import asyncio
import json
import time
from datetime import datetime, timezone
from typing import Any

import httpx

GOVMAP_URL  = "https://es.govmap.gov.il/TldSearch/api/AutoComplete"
NADLAN_API  = "/Nadlan.REST/Main/GetAssestAndDeals"   # relative — runs inside the browser
NADLAN_HOME = "https://www.nadlan.gov.il/"
POLITE_SLEEP = 2.5

CITY_SEEDS: dict[int, list[str]] = {
    70:   ["שדרות ירושלים 60, אשדוד", "שדרות העצמאות 30, אשדוד"],
    650:  ["שדרות הציונות 45, אשקלון", "שדרות אנדלוסיה 20, אשקלון"],
    1200: ["שדרות יצחק רבין 3, מודיעין"],
    3000: ["יפו 87, ירושלים", "בן יהודה 17, ירושלים", "המלך ג'ורג' 30, ירושלים"],
    4000: ["הרצל 55, חיפה", "שדרות הנשיא 40, חיפה"],
    5000: ["דיזנגוף 99, תל אביב", "אלנבי 58, תל אביב", "בן יהודה 44, תל אביב"],
    6200: ["ז'בוטינסקי 25, בני ברק", "רבי עקיבא 80, בני ברק"],
    6300: ["בן גוריון 30, בת ים", "ביאליק 40, בת ים"],
    6400: ["הרצל 36, הרצליה", "שדרות בן גוריון 20, הרצליה"],
    6600: ["שדרות ירושלים 75, חולון", "גולדה מאיר 30, חולון"],
    6900: ["ז'בוטינסקי 46, כפר סבא", "בן גוריון 22, כפר סבא"],
    7400: ["הרצל 44, נתניה", "שדרות ויצמן 18, נתניה"],
    7900: ["ז'בוטינסקי 52, פתח תקווה", "שדרות הגבורה 28, פתח תקווה"],
    8300: ["ז'בוטינסקי 76, ראשון לציון", "ביאליק 33, ראשון לציון"],
    8400: ["הרצל 40, רחובות", "ביאליק 22, רחובות"],
    8600: ["ביאליק 43, רמת גן", "ז'בוטינסקי 88, רמת גן"],
    8700: ["ז'בוטינסקי 38, רעננה", "אחוזה 80, רעננה"],
    9000: ["שדרות רגר 90, באר שבע", "שדרות בן גוריון 42, באר שבע"],
}


def _geocode_sync(address: str) -> dict[str, Any] | None:
    """Geocode via govmap — no auth needed, plain httpx call."""
    try:
        with httpx.Client(timeout=15) as client:
            r = client.get(
                GOVMAP_URL,
                params={"query": address, "ids": "276267023", "gid": "govmap"},
                headers={"Referer": "https://www.govmap.gov.il/", "Accept": "application/json"},
            )
            r.raise_for_status()
            data = r.json()
            results = (data.get("res") or {}).get("ADDRESS") or []
            return results[0] if results else None
    except Exception as e:
        print(f"[nadlan] geocode error for '{address}': {e}", flush=True)
        return None


async def _fetch_page_via_browser(page: Any, geocoded: dict, page_num: int, page_size: int = 50) -> dict | None:
    """
    Call the nadlan REST API from inside the browser via page.evaluate().
    This uses the browser's own cookies/session tokens, bypassing CSRF issues.
    """
    body = {
        "query":        geocoded.get("Key", ""),
        "CurrentLavel": 3,
        "ResultLable":  geocoded.get("Value", ""),
        "ResultType":   3,
        "ObjectID":     geocoded.get("ObjectID") or geocoded.get("Key"),
        "ObjectIDType": 3,
        "DescLayerID":  "ADDR_V1",
        "X":            geocoded.get("X") or 0,
        "Y":            geocoded.get("Y") or 0,
        "Page":         page_num,
        "PageSize":     page_size,
    }

    js = """
    async ({url, body}) => {
        try {
            const r = await fetch(url, {
                method:  'POST',
                headers: {'Content-Type': 'application/json', 'Accept': 'application/json'},
                body:    JSON.stringify(body),
            });
            if (!r.ok) return {error: r.status};
            const ct = r.headers.get('content-type') || '';
            if (!ct.includes('json')) return {error: 'non-json: ' + ct};
            return await r.json();
        } catch (e) {
            return {error: String(e)};
        }
    }
    """

    try:
        result = await page.evaluate(js, {"url": NADLAN_API, "body": body})
        if isinstance(result, dict) and "error" in result:
            print(f"[nadlan] page.evaluate error p{page_num}: {result['error']}", flush=True)
            return None
        return result
    except Exception as e:
        print(f"[nadlan] page.evaluate exception p{page_num}: {e}", flush=True)
        return None


def _normalize_deal(
    raw: dict[str, Any],
    source_address: str,
    city_id: int | None = None,
    city_name: str | None = None,
) -> dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat()
    deal_id = (
        f"{raw.get('DEALDATETIME','')}_{raw.get('GUSH','')}_{raw.get('HELKA','')}_{raw.get('DEALAMOUNT','')}"
    ).replace(" ", "_").replace(":", "-")

    floor_str = (raw.get("FLOORNO") or "").strip()
    floor = next((int(t) for t in floor_str.split() if t.isdigit()), None)

    price    = int(raw.get("DEALAMOUNT") or 0)
    area     = float(raw["DEALSIZE"]) if raw.get("DEALSIZE") else None
    ppsqm    = round(price / area) if price and area else None

    return {
        "listing_id":   f"nadlan_gov:{deal_id}",
        "source_site":  "nadlan_gov",
        "source_url":   None,
        "price_nis":    price,
        "price_type":   "sold_transaction",
        "deal_type":    "sale",
        "property_type": raw.get("DEALNATUREDESCRIPTION") or "apartment",
        "rooms":        float(raw["ASSETROOMNUM"]) if raw.get("ASSETROOMNUM") is not None else None,
        "area_sqm":     area,
        "floor":        floor,
        "total_floors": int(raw["BUILDINGFLOORS"]) if raw.get("BUILDINGFLOORS") else None,
        "year_built":   int(raw["BUILDINGYEAR"]) if raw.get("BUILDINGYEAR") else None,
        "city":         city_name,
        "city_id":      city_id,
        "street":       raw.get("ADDRESS") or source_address,
        "lat":          None,
        "lon":          None,
        "price_per_sqm": ppsqm,
        "poster_type":  None,
        "published_at": raw.get("DEALDATETIME"),
        "gush":         raw.get("GUSH"),
        "helka":        raw.get("HELKA"),
        "first_seen":   now,
        "last_seen":    now,
    }


async def fetch_sold_transactions(address: str, max_pages: int = 10) -> list[dict[str, Any]]:
    """Fetch sold transactions near a single address using in-browser API calls."""
    from playwright.async_api import async_playwright

    geocoded = _geocode_sync(address)
    if not geocoded:
        print(f"[nadlan] No geocode result for: {address}", flush=True)
        return []
    print(f"[nadlan] Geocoded: {geocoded.get('Value')}", flush=True)

    results: list[dict[str, Any]] = []

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            ),
            locale="he-IL",
        )
        page = await ctx.new_page()
        await page.goto(NADLAN_HOME, wait_until="networkidle", timeout=30_000)
        print("[nadlan] Browser session ready", flush=True)

        for page_num in range(1, max_pages + 1):
            data = await _fetch_page_via_browser(page, geocoded, page_num)
            if not data:
                break

            page_results = data.get("AllResults") or []
            if not page_results:
                break

            for raw in page_results:
                results.append(_normalize_deal(raw, address))

            total = data.get("TotalDeals") or len(results)
            print(f"[nadlan] Page {page_num}: +{len(page_results)} deals ({len(results)}/{total})", flush=True)
            if len(results) >= total:
                break
            await asyncio.sleep(POLITE_SLEEP)

        await browser.close()

    return results


async def fetch_transactions_for_cities(
    city_requests: list[dict],
    max_pages_per_seed: int = 5,
) -> list[dict[str, Any]]:
    """
    Bulk-fetch sold transactions for multiple cities.
    Boots Playwright once, reuses the session across all seeds.
    Returns deduplicated transactions from the last 24 months.
    """
    from playwright.async_api import async_playwright

    cutoff_ts = datetime.now(timezone.utc).timestamp() - 2 * 365 * 86_400

    print(f"[nadlan] Starting bulk fetch for {len(city_requests)} cities…", flush=True)

    all_results: list[dict[str, Any]] = []
    seen_ids: set[str] = set()

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            ),
            locale="he-IL",
        )
        page = await ctx.new_page()
        await page.goto(NADLAN_HOME, wait_until="networkidle", timeout=45_000)
        print("[nadlan] Browser session ready", flush=True)

        for req in city_requests:
            city_id   = req.get("cityId")
            city_name = req.get("cityNameHe", "")
            seeds     = CITY_SEEDS.get(city_id, [city_name])

            for address in seeds:
                geocoded = _geocode_sync(address)
                if not geocoded:
                    print(f"[nadlan] No geocode for: {address}", flush=True)
                    await asyncio.sleep(POLITE_SLEEP)
                    continue

                print(f"[nadlan] {city_name} — '{address}' → {geocoded.get('Value')}", flush=True)

                for page_num in range(1, max_pages_per_seed + 1):
                    data = await _fetch_page_via_browser(page, geocoded, page_num)
                    if not data:
                        break

                    page_results = data.get("AllResults") or []
                    if not page_results:
                        break

                    for raw in page_results:
                        date_str = raw.get("DEALDATETIME")
                        if date_str:
                            try:
                                tx_ts = datetime.fromisoformat(date_str.replace("Z", "+00:00")).timestamp()
                                if tx_ts < cutoff_ts:
                                    continue
                            except Exception:
                                pass

                        key = (
                            f"{raw.get('GUSH')}_{raw.get('HELKA')}_"
                            f"{raw.get('DEALDATETIME')}_{raw.get('DEALAMOUNT')}"
                        )
                        if key in seen_ids:
                            continue
                        seen_ids.add(key)
                        all_results.append(_normalize_deal(raw, address, city_id, city_name))

                    await asyncio.sleep(POLITE_SLEEP)

            print(f"[nadlan] {city_name}: done ({len(all_results)} total so far)", flush=True)

        await browser.close()

    print(f"[nadlan] Bulk fetch complete — {len(all_results)} unique transactions", flush=True)
    return all_results
