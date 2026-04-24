-- CreateTable
CREATE TABLE "City" (
    "id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "nameHe" TEXT NOT NULL,
    "topArea" INTEGER NOT NULL,

    CONSTRAINT "City_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Neighborhood" (
    "id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "nameHe" TEXT NOT NULL,
    "cityId" INTEGER NOT NULL,

    CONSTRAINT "Neighborhood_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Listing" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "priceNis" INTEGER NOT NULL,
    "pricePerSqm" INTEGER,
    "dealType" TEXT NOT NULL,
    "propertyType" TEXT,
    "rooms" DOUBLE PRECISION,
    "areaSqm" DOUBLE PRECISION,
    "floor" INTEGER,
    "cityId" INTEGER,
    "neighborhoodId" INTEGER,
    "cityRaw" TEXT,
    "neighborhoodRaw" TEXT,
    "street" TEXT,
    "lat" DOUBLE PRECISION,
    "lon" DOUBLE PRECISION,
    "posterType" TEXT,
    "publishedAt" TIMESTAMP(3),
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Listing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListingHistory" (
    "id" SERIAL NOT NULL,
    "listingId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ListingHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SoldTransaction" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "cityRaw" TEXT,
    "lat" DOUBLE PRECISION,
    "lon" DOUBLE PRECISION,
    "priceNis" INTEGER NOT NULL,
    "areaSqm" DOUBLE PRECISION,
    "pricePerSqm" INTEGER,
    "rooms" DOUBLE PRECISION,
    "floor" INTEGER,
    "transactionDate" TIMESTAMP(3),
    "source" TEXT NOT NULL DEFAULT 'nadlan_gov',
    "gush" INTEGER,
    "helka" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SoldTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListingComparison" (
    "id" SERIAL NOT NULL,
    "listingId" TEXT NOT NULL,
    "numTransactions" INTEGER NOT NULL,
    "avgPricePerSqm" INTEGER NOT NULL,
    "medianPricePerSqm" INTEGER NOT NULL,
    "pctDiff" DOUBLE PRECISION NOT NULL,
    "classification" TEXT NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ListingComparison_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScanJob" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "params" JSONB NOT NULL,
    "listingsFound" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ScanJob_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Neighborhood" ADD CONSTRAINT "Neighborhood_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_neighborhoodId_fkey" FOREIGN KEY ("neighborhoodId") REFERENCES "Neighborhood"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingHistory" ADD CONSTRAINT "ListingHistory_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingComparison" ADD CONSTRAINT "ListingComparison_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
