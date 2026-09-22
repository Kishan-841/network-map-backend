-- A building can now record the OLT and PON port that serve it, filled in bulk
-- from the Buildings tab. Nullable so the 1000+ existing buildings are
-- untouched; SET NULL on a deleted OLT keeps the building and just clears the
-- mapping. The OLT's zone is its POP's zone — no zone column is stored here.
ALTER TABLE "Building" ADD COLUMN "oltId" TEXT;
ALTER TABLE "Building" ADD COLUMN "ponPort" INTEGER;
ALTER TABLE "Building" ADD CONSTRAINT "Building_oltId_fkey"
  FOREIGN KEY ("oltId") REFERENCES "Olt"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Building_oltId_idx" ON "Building"("oltId");
