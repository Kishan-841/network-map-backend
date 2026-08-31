-- CreateEnum
CREATE TYPE "BillingPeriod" AS ENUM ('QUARTERLY', 'HALF_YEARLY', 'YEARLY');

-- CreateTable
CREATE TABLE "RateCard" (
    "id" TEXT NOT NULL,
    "speedMbps" INTEGER NOT NULL,
    "billingPeriod" "BillingPeriod" NOT NULL,
    "amount" INTEGER NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RateCard_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RateCard_effectiveFrom_idx" ON "RateCard"("effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "RateCard_speedMbps_billingPeriod_effectiveFrom_key" ON "RateCard"("speedMbps", "billingPeriod", "effectiveFrom");
