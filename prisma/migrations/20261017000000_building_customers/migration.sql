-- Building customers (spec 2026-10-17). Additive only.
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "username" TEXT,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "mobile" TEXT NOT NULL,
    "email" TEXT,
    "site" TEXT,
    "operator" TEXT,
    "networkZone" TEXT,
    "planName" TEXT,
    "planAmount" INTEGER,
    "planValidityDays" INTEGER,
    "autoRenewal" BOOLEAN,
    "planActivatedAt" TIMESTAMP(3),
    "planExpiresAt" TIMESTAMP(3),
    "status" TEXT,
    "ageingDays" INTEGER,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Customer_buildingId_idx" ON "Customer"("buildingId");
CREATE INDEX "Customer_mobile_idx" ON "Customer"("mobile");
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
