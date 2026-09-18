-- A fiber now records the zone it runs in, so the map's zone filter narrows
-- cables the way it already narrows buildings, and a surveyor draws only
-- inside the zones they are assigned to.
-- Nullable: the fibers drawn before this have no zone, and SET NULL on a
-- deleted zone keeps the cable — the line is real whatever we call the area.
ALTER TABLE "Fiber" ADD COLUMN "zoneId" TEXT;
ALTER TABLE "Fiber" ADD CONSTRAINT "Fiber_zoneId_fkey"
  FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Fiber_zoneId_idx" ON "Fiber"("zoneId");
