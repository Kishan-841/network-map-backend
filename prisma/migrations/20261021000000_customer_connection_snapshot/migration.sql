-- Last known OLT connection status per customer (additive; all columns nullable).
ALTER TABLE "Customer"
  ADD COLUMN "connState" TEXT,
  ADD COLUMN "connRxDbm" DOUBLE PRECISION,
  ADD COLUMN "connRxQuality" TEXT,
  ADD COLUMN "connOlt" TEXT,
  ADD COLUMN "connPon" INTEGER,
  ADD COLUMN "connOnu" INTEGER,
  ADD COLUMN "connLastSeen" TIMESTAMP(3),
  ADD COLUMN "connWeak" BOOLEAN,
  ADD COLUMN "connCheckedAt" TIMESTAMP(3);

CREATE INDEX "Customer_connState_idx" ON "Customer"("connState");
CREATE INDEX "Customer_connCheckedAt_idx" ON "Customer"("connCheckedAt");
CREATE INDEX "Customer_planExpiresAt_idx" ON "Customer"("planExpiresAt");
CREATE INDEX "Customer_operator_idx" ON "Customer"("operator");
CREATE INDEX "Customer_networkZone_idx" ON "Customer"("networkZone");
