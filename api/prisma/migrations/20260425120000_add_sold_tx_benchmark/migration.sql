-- Add cityId to SoldTransaction for efficient city-based lookup
ALTER TABLE "SoldTransaction" ADD COLUMN "cityId" INTEGER;

-- Add benchmark metadata to ListingComparison
ALTER TABLE "ListingComparison" ADD COLUMN "benchmarkSource" TEXT NOT NULL DEFAULT 'active_listings';
ALTER TABLE "ListingComparison" ADD COLUMN "soldComparables" INTEGER NOT NULL DEFAULT 0;
