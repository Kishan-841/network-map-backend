-- A POP now records the zone it sits in, so a surveyor sees the sites in the
-- zones they work and not every site in the city.
-- Nullable: POPs recorded before this have no zone and stay visible to
-- everyone until one is set. SET NULL on a deleted zone keeps the site — the
-- building is real whatever we call the area around it.
ALTER TABLE "Pop" ADD COLUMN "zoneId" TEXT;
ALTER TABLE "Pop" ADD CONSTRAINT "Pop_zoneId_fkey"
  FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Pop_zoneId_idx" ON "Pop"("zoneId");
