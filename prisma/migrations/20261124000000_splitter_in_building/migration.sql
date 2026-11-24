-- A splitter fitted inside a building (Splitters page, 24 Nov 2026). Additive: every column is nullable,
-- existing splitters are untouched.
ALTER TABLE "Splitter" ADD COLUMN "buildingId" TEXT;
ALTER TABLE "Splitter" ADD COLUMN "wingId" TEXT;
ALTER TABLE "Splitter" ADD COLUMN "placement" TEXT;
ALTER TABLE "Splitter" ADD COLUMN "floorNumber" INTEGER;
ALTER TABLE "Splitter" ADD COLUMN "note" TEXT;

CREATE INDEX "Splitter_buildingId_idx" ON "Splitter"("buildingId");

ALTER TABLE "Splitter" ADD CONSTRAINT "Splitter_buildingId_fkey"
  FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Splitter" ADD CONSTRAINT "Splitter_wingId_fkey"
  FOREIGN KEY ("wingId") REFERENCES "BuildingWing"("id") ON DELETE SET NULL ON UPDATE CASCADE;
