"""
Python scraper microservice.
The Node.js API calls POST /scrape with search params.
Returns normalized listings from Yad2 (and optionally nadlan.gov.il).
"""
import asyncio
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

import yad2

app = FastAPI(title="Nadlan Scraper")


class ScrapeParams(BaseModel):
    cityId: int
    neighborhoodId: int | None = None
    dealType: str = "sale"
    minPrice: int | None = None
    maxPrice: int | None = None
    minSqm: int | None = None
    maxSqm: int | None = None
    minRooms: float | None = None
    maxRooms: float | None = None


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/scrape")
async def scrape(params: ScrapeParams):
    deal_type = "forsale" if params.dealType == "sale" else "rent"
    try:
        listings = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: yad2.scrape(
                city_id=params.cityId,
                neighborhood_id=params.neighborhoodId,
                deal_type=deal_type,
                min_price=params.minPrice,
                max_price=params.maxPrice,
                min_sqm=params.minSqm,
                max_sqm=params.maxSqm,
                min_rooms=params.minRooms,
                max_rooms=params.maxRooms,
                max_pages=40,
                rate_s=3.0,
            ),
        )
        return {"listings": listings, "count": len(listings)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/sold-transactions")
async def sold_transactions(body: dict[str, Any]):
    """Fetch sold transactions near a single address."""
    from nadlan import fetch_sold_transactions
    address = body.get("address")
    if not address:
        raise HTTPException(status_code=400, detail="address required")
    try:
        results = await fetch_sold_transactions(address, max_pages=body.get("maxPages", 5))
        return {"transactions": results, "count": len(results)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class BulkCityRequest(BaseModel):
    cities: list[dict]          # [{cityId, cityNameHe}]
    maxPagesPerSeed: int = 5


@app.post("/sold-transactions-bulk")
async def sold_transactions_bulk(params: BulkCityRequest):
    """
    Bulk-fetch sold transactions for all supplied cities.
    Bootstraps Playwright once, queries each city's seed addresses,
    deduplicates, and returns transactions from the last 24 months.
    """
    from nadlan import fetch_transactions_for_cities
    try:
        results = await fetch_transactions_for_cities(
            params.cities,
            max_pages_per_seed=params.maxPagesPerSeed,
        )
        return {"transactions": results, "count": len(results)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
