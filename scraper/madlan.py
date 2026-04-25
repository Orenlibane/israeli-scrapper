"""
Madlan.co.il listing scraper.
Uses Playwright to bypass PerimeterX bot protection.
Navigates to the city's listing page, then paginates via page.evaluate()
to call /api2 GraphQL from inside the browser context (which carries the
real PerimeterX session tokens).

Output matches yad2.py format so workers.ts upsertListing handles both.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any

API2_URL   = "/api2"          # relative — called from inside the browser
WEB_HOST   = "https://www.madlan.co.il"
PAGE_LIMIT = 40

# Maps our DB city IDs to Hebrew URL slugs and bounding-box tile ranges (zoom 13).
# Tile ranges cover slightly more area than the city boundary to avoid missing edges.
CITY_CFG: dict[int, dict] = {
    5000: {"slug": "תל-אביב-יפו",        "name": "תל אביב יפו",        "x1": 4885, "y1": 3320, "x2": 4892, "y2": 3326},
    3000: {"slug": "ירושלים",             "name": "ירושלים",             "x1": 4880, "y1": 3329, "x2": 4886, "y2": 3335},
    4000: {"slug": "חיפה",                "name": "חיפה",                "x1": 4876, "y1": 3311, "x2": 4882, "y2": 3317},
    8300: {"slug": "ראשון-לציון",         "name": "ראשון לציון",         "x1": 4883, "y1": 3325, "x2": 4889, "y2": 3330},
    7900: {"slug": "פתח-תקווה",           "name": "פתח תקווה",           "x1": 4885, "y1": 3318, "x2": 4891, "y2": 3323},
    70:   {"slug": "אשדוד",              "name": "אשדוד",               "x1": 4879, "y1": 3330, "x2": 4885, "y2": 3335},
    7400: {"slug": "נתניה",              "name": "נתניה",               "x1": 4881, "y1": 3314, "x2": 4887, "y2": 3319},
    9000: {"slug": "באר-שבע",            "name": "באר שבע",             "x1": 4880, "y1": 3340, "x2": 4886, "y2": 3346},
    6600: {"slug": "חולון",              "name": "חולון",               "x1": 4884, "y1": 3323, "x2": 4889, "y2": 3328},
    6200: {"slug": "בני-ברק",            "name": "בני ברק",             "x1": 4886, "y1": 3319, "x2": 4891, "y2": 3324},
    8600: {"slug": "רמת-גן",             "name": "רמת גן",              "x1": 4887, "y1": 3320, "x2": 4892, "y2": 3324},
    6400: {"slug": "הרצליה",             "name": "הרצליה",              "x1": 4882, "y1": 3315, "x2": 4887, "y2": 3320},
    6900: {"slug": "כפר-סבא",            "name": "כפר סבא",             "x1": 4883, "y1": 3315, "x2": 4888, "y2": 3320},
    8400: {"slug": "רחובות",             "name": "רחובות",              "x1": 4882, "y1": 3323, "x2": 4888, "y2": 3328},
    1200: {"slug": "מודיעין-מכבים-רעות", "name": "מודיעין מכבים רעות",  "x1": 4879, "y1": 3324, "x2": 4885, "y2": 3329},
    8700: {"slug": "רעננה",              "name": "רעננה",               "x1": 4883, "y1": 3316, "x2": 4888, "y2": 3320},
    650:  {"slug": "אשקלון",             "name": "אשקלון",              "x1": 4877, "y1": 3332, "x2": 4883, "y2": 3337},
    6300: {"slug": "בת-ים",              "name": "בת ים",               "x1": 4884, "y1": 3325, "x2": 4889, "y2": 3329},
}

_GQL = """
query searchPoiV2($where: searchPoiV2Where!, $pagination: searchPoiV2Pagination) {
  searchPoiV2(where: $where, pagination: $pagination) {
    bulletins {
      id price rooms squareMeter floor
      address { city { text } neighborhood { text } street houseNumber }
      dealType propertyType
      seller { type }
      geolocation { lat lon }
    }
    totalCount
  }
}
""".strip()


def _normalize(item: dict[str, Any], city_id: int, deal_type: str) -> dict[str, Any] | None:
    raw_id = item.get("id")
    if not raw_id:
        return None

    addr   = item.get("address") or {}
    city   = (addr.get("city") or {}).get("text") or (CITY_CFG.get(city_id) or {}).get("name")
    nbhd   = (addr.get("neighborhood") or {}).get("text")
    street = " ".join(filter(None, [addr.get("street"), str(addr.get("houseNumber") or "")])).strip() or None

    def _int(v: Any) -> int:
        try: return int(v or 0)
        except: return 0

    def _float(v: Any) -> float | None:
        try: return float(v) if v is not None else None
        except: return None

    price = _int(item.get("price"))
    area  = _float(item.get("squareMeter"))
    rooms = _float(item.get("rooms"))
    floor = _int(item.get("floor")) if item.get("floor") is not None else None
    ppsqm = round(price / area) if price and area else None

    geo   = item.get("geolocation") or {}

    raw_deal = (item.get("dealType") or "").upper()
    norm_deal = "rent" if raw_deal == "RENT" else "sale"

    seller_type = ((item.get("seller") or {}).get("type") or "").lower()
    poster = "owner" if seller_type in ("private", "owner") else "agent"

    now = datetime.now(timezone.utc).isoformat()

    return {
        "listing_id":    f"madlan:{raw_id}",
        "source_site":   "madlan",
        "source_url":    f"{WEB_HOST}/listing/{raw_id}",
        "price_nis":     price,
        "price_per_sqm": ppsqm,
        "deal_type":     norm_deal,
        "property_type": item.get("propertyType") or "דירה",
        "rooms":         rooms,
        "area_sqm":      area,
        "floor":         floor,
        "city":          city,
        "neighborhood":  nbhd,
        "street":        street,
        "lat":           geo.get("lat"),
        "lon":           geo.get("lon"),
        "poster_type":   poster,
        "published_at":  None,
        "first_seen":    now,
        "last_seen":     now,
    }


async def _scrape_async(city_id: int, deal_type: str, max_pages: int) -> list[dict[str, Any]]:
    """
    Intercept the searchPoiV2 response that the Madlan page itself makes.
    PerimeterX runs its challenge in JS, so the page's own XHR to /api2 succeeds.
    We capture those responses via page.on("response") and then paginate by
    scrolling / modifying the URL to trigger more API calls.
    """
    from playwright.async_api import async_playwright

    cfg = CITY_CFG.get(city_id)
    if not cfg:
        print(f"[madlan] Unknown city_id={city_id}", flush=True)
        return []

    madlan_deal = "FORSALE" if deal_type in ("forsale", "sale") else "RENT"
    url_deal    = "for-sale" if madlan_deal == "FORSALE" else "for-rent"
    start_url   = f"{WEB_HOST}/{url_deal}/{cfg['slug']}"

    results: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    captured: list[dict] = []

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

        # Intercept /api2 responses made by the page itself
        async def on_response(response: Any) -> None:
            if "/api2" in response.url and response.status == 200:
                try:
                    data = await response.json()
                    search = ((data or {}).get("data") or {}).get("searchPoiV2")
                    if search:
                        captured.append(search)
                except Exception:
                    pass

        page.on("response", on_response)

        # Navigate — PerimeterX runs its JS challenge here
        print(f"[madlan] Navigating to {start_url}", flush=True)
        try:
            await page.goto(start_url, wait_until="load", timeout=45_000)
        except Exception as e:
            print(f"[madlan] Navigation warning: {e}", flush=True)

        # Wait for the page's own API call to fire and be captured
        for _ in range(20):
            if captured:
                break
            await asyncio.sleep(0.5)

        # Process first-page results from intercepted responses
        total = 0
        for search in captured:
            total = search.get("totalCount") or total
            for item in (search.get("bulletins") or []):
                rid = item.get("id")
                if not rid or rid in seen_ids:
                    continue
                seen_ids.add(rid)
                norm = _normalize(item, city_id, deal_type)
                if norm:
                    results.append(norm)

        print(f"[madlan] city={city_id} total={total} captured_p1={len(results)}", flush=True)

        # Paginate: call /api2 from the browser context with offset.
        # At this point PerimeterX is satisfied, so same-origin fetch works.
        if total > PAGE_LIMIT and max_pages > 1:
            js = """
            async ({url, gql, variables}) => {
                try {
                    const r = await fetch(url, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Accept': 'application/json',
                        },
                        body: JSON.stringify({
                            operationName: 'searchPoiV2',
                            query: gql,
                            variables,
                        }),
                    });
                    if (!r.ok) return {error: r.status};
                    return await r.json();
                } catch(e) {
                    return {error: String(e)};
                }
            }
            """

            for page_num in range(2, min(max_pages + 1, (total // PAGE_LIMIT) + 2)):
                variables = {
                    "where": {
                        "dealType":      madlan_deal,
                        "poiTypes":      ["bulletin"],
                        "tileRanges":    [{
                            "x1": cfg["x1"], "y1": cfg["y1"],
                            "x2": cfg["x2"], "y2": cfg["y2"],
                        }],
                        "searchContext": "marketplace",
                    },
                    "pagination": {
                        "limit":  PAGE_LIMIT,
                        "offset": (page_num - 1) * PAGE_LIMIT,
                    },
                }

                data = await page.evaluate(js, {"url": API2_URL, "gql": _GQL, "variables": variables})

                if isinstance(data, dict) and "error" in data:
                    print(f"[madlan] page {page_num} error: {data['error']}", flush=True)
                    break

                search = ((data or {}).get("data") or {}).get("searchPoiV2") or {}
                items  = search.get("bulletins") or []
                new = 0
                for item in items:
                    rid = item.get("id")
                    if not rid or rid in seen_ids:
                        continue
                    seen_ids.add(rid)
                    norm = _normalize(item, city_id, deal_type)
                    if norm:
                        results.append(norm)
                        new += 1

                print(f"[madlan] p{page_num}: {len(items)} items +{new} new (total {len(results)})", flush=True)
                if not items or len(results) >= total:
                    break
                await asyncio.sleep(1.5)

        await browser.close()

    print(f"[madlan] city={city_id} deal={deal_type} → {len(results)} listings total", flush=True)
    return results


def scrape(
    city_id: int,
    deal_type: str = "forsale",
    max_pages: int = 20,
    rate_s: float = 1.5,   # kept for API compat, unused
) -> list[dict[str, Any]]:
    """Sync wrapper for async Playwright scraper. Never raises."""
    try:
        return asyncio.run(_scrape_async(city_id, deal_type, max_pages))
    except Exception as e:
        print(f"[madlan] scrape error city={city_id}: {e}", flush=True)
        return []
