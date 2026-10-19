-- Customer wings + PON/OLT (spec 2026-10-19). Additive only.
ALTER TABLE "Customer" ADD COLUMN "wingId" TEXT, ADD COLUMN "ponNumber" TEXT, ADD COLUMN "olt" TEXT;
CREATE INDEX "Customer_wingId_idx" ON "Customer"("wingId");
CREATE INDEX "Customer_username_idx" ON "Customer"("username");
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_wingId_fkey" FOREIGN KEY ("wingId") REFERENCES "BuildingWing"("id") ON DELETE SET NULL ON UPDATE CASCADE;
