"""
nadlan.gov.il transaction fetcher.
Uses Playwright to bootstrap a browser session (the site is an SPA that
requires JS execution before the API responds with JSON), then re-uses
the session cookies/headers with httpx for all paginated requests.
"""
from __future__ import annotations

import asyncio
import json
import time
from datetime import datetime, timezone
from typing import Any

import httpx

GOVMAP_URL = "https://es.govmap.gov.il/TldSearch/api/AutoComplete"
NADLAN_API  = "https://www.nadlan.gov.il/Nadlan.REST/Main/GetAssestAndDeals"
NADLAN_HOME = "https://www.nadlan.gov.il/"
POLITE_SLEEP = 2.0


async def _bootstrap_session() -> dict[str, str]:
    """
    Launch a headless browser, load nadlan.gov.il, wait for the SPA to
    initialise, then extract the cookies and request headers the site sets.
    Returns a dict of headers safe to pass to httpx.
    """
    from playwright.async_api import async_playwright

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            locale="he-IL",
        )
        page = await ctx.new_page()

        captured: dict[str, str] = {}

        # Intercept the first successful JSON API call so we learn what
        # headers the browser sends — replicate those with httpx.
        async def on_response(response):
            if "Nadlan.REST" in response.url and response.status == 200:
                try:
                    ct = response.headers.get("content-type", "")
                    if "json" in ct:
                        req_headers = await response.request.all_headers()
                        captured.update(req_headers)
                except Exception:
                    pass

        page.on("response", on_response)

        await page.goto(NADLAN_HOME, wait_until="networkidle", timeout=30_000)
        # Wait up to 5s for a captured API call; the site may not make one on
        # the homepage — that's fine, we just need the cookies.
        for _ in range(10):
            if captured:
                break
            await asyncio.sleep(0.5)

        # Extract cookies
        cookies = await ctx.cookies()
        cookie_str = "; ".join(f"{c['name']}={c['value']}" for c in cookies)

        await browser.close()

    headers = {
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "he-IL,he;q=0.9,en;q=0.8",
        "Content-Type": "application/json",
        "Origin": "https://www.nadlan.gov.il",
        "Referer": "https://www.nadlan.gov.il/",
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        ),
    }
    if cookie_str:
        headers["Cookie"] = cookie_str
    # Merge any headers we captured from an intercepted request
    for k, v in captured.items():
        if k.lower() in ("cookie", "authorization", "x-requested-with"):
            headers[k] = v

    return headers


def _geocode(address: str, client: httpx.Client) -> dict[str, Any] | None:
    params = {"query": address, "ids": "276267023", "gid": "govmap"}
    r = client.get(
        GOVMAP_URL,
        params=params,
        headers={"Referer": "https://www.govmap.gov.il/", "Accept": "application/json"},
        timeout=20,
    )
    r.raise_for_status()
    data = r.json()
    return ((data.get("res") or {}).get("ADDRESS") or [None])[0]


def _fetch_deals_page(
    client: httpx.Client,
    geocoded: dict[str, Any],
    page: int,
    page_size: int = 50,
) -> dict[str, Any]:
    body = {
        "query": geocoded.get("Key", ""),
        "CurrentLavel": 3,
        "ResultLable": geocoded.get("Value", ""),
        "ResultType": 3,
        "ObjectID": geocoded.get("ObjectID") or geocoded.get("Key"),
        "ObjectIDType": 3,
        "DescLayerID": "ADDR_V1",
        "X": geocoded.get("X") or 0,
        "Y": geocoded.get("Y") or 0,
        "Page": page,
        "PageSize": page_size,
    }
    r = client.post(NADLAN_API, json=body, timeout=30)
    r.raise_for_status()
    # Guard against SPA HTML fallback
    ct = r.headers.get("content-type", "")
    if "json" not in ct:
        raise ValueError(f"Expected JSON from nadlan API, got: {ct[:80]}")
    return r.json()


def _normalize_deal(raw: dict[str, Any], source_address: str) -> dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat()
    deal_id = (
        f"{raw.get('DEALDATETIME','')}_{raw.get('GUSH','')}_{raw.get('HELKA','')}_{raw.get('DEALAMOUNT','')}"
    ).replace(" ", "_").replace(":", "-")

    floor_str = (raw.get("FLOORNO") or "").strip()
    floor = next((int(t) for t in floor_str.split() if t.isdigit()), None)

    price = int(raw.get("DEALAMOUNT") or 0)
    area  = float(raw["DEALSIZE"]) if raw.get("DEALSIZE") else None
    price_per_sqm = round(price / area) if price and area else None

    return {
        "listing_id": f"nadlan_gov:{deal_id}",
        "source_site": "nadlan_gov",
        "source_url": None,
        "price_nis": price,
        "price_type": "sold_transaction",
        "deal_type": "sale",
        "property_type": raw.get("DEALNATUREDESCRIPTION") or "apartment",
        "rooms": float(raw["ASSETROOMNUM"]) if raw.get("ASSETROOMNUM") is not None else None,
        "area_sqm": area,
        "area_type": "gross",
        "floor": floor,
        "total_floors": int(raw["BUILDINGFLOORS"]) if raw.get("BUILDINGFLOORS") else None,
        "year_built": int(raw["BUILDINGYEAR"]) if raw.get("BUILDINGYEAR") else None,
        "city": None,
        "street": raw.get("ADDRESS") or source_address,
        "lat": None,
        "lon": None,
        "price_per_sqm": price_per_sqm,
        "poster_type": None,
        "published_at": raw.get("DEALDATETIME"),
        "gush": raw.get("GUSH"),
        "helka": raw.get("HELKA"),
        "first_seen": now,
        "last_seen": now,
    }


async def fetch_sold_transactions(address: str, max_pages: int = 10) -> list[dict[str, Any]]:
    """
    Fetch sold transactions near the given Hebrew address.
    Bootstraps a Playwright session first, then uses httpx for pagination.
    """
    print(f"[nadlan] Bootstrapping browser session...", flush=True)
    headers = await _bootstrap_session()
    print(f"[nadlan] Session ready. Geocoding: {address}", flush=True)

    results: list[dict[str, Any]] = []

    with httpx.Client(headers=headers) as client:
        geocoded = _geocode(address, client)
        if not geocoded:
            print(f"[nadlan] No geocode result for: {address}", flush=True)
            return []
        print(f"[nadlan] Geocoded → {geocoded.get('Value')}", flush=True)
        time.sleep(POLITE_SLEEP)

        for page in range(1, max_pages + 1):
            try:
                data = _fetch_deals_page(client, geocoded, page)
            except ValueError as e:
                print(f"[nadlan] API returned non-JSON (session expired?): {e}", flush=True)
                break

            page_results = data.get("AllResults") or []
            if not page_results:
                break

            for raw in page_results:
                results.append(_normalize_deal(raw, address))

            total = data.get("TotalDeals") or len(results)
            print(f"[nadlan] Page {page}: +{len(page_results)} deals ({len(results)}/{total})", flush=True)
            if len(results) >= total:
                break
            time.sleep(POLITE_SLEEP)

    return results
