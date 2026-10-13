-- Performance indexes (13 Oct 2026). Additive only: no data changes.
-- Each backs a filter or join used on a hot path that scanned the whole
-- table: zone/city/date filters on buildings and stats, photo cascades on
-- building delete, the visit-plan uploads list and hand-overs, fibre point
-- deletes, closure/splitter lookups, and partner-lead dashboards.

CREATE INDEX IF NOT EXISTS "Building_zoneId_idx" ON "Building"("zoneId");
CREATE INDEX IF NOT EXISTS "Building_cityId_idx" ON "Building"("cityId");
CREATE INDEX IF NOT EXISTS "Building_createdAt_idx" ON "Building"("createdAt");

CREATE INDEX IF NOT EXISTS "Photo_buildingId_idx" ON "Photo"("buildingId");

CREATE INDEX IF NOT EXISTS "VisitTask_uploadId_idx" ON "VisitTask"("uploadId");
CREATE INDEX IF NOT EXISTS "VisitTask_buildingId_idx" ON "VisitTask"("buildingId");

CREATE INDEX IF NOT EXISTS "FiberSegment_fromPointId_idx" ON "FiberSegment"("fromPointId");
CREATE INDEX IF NOT EXISTS "FiberSegment_toPointId_idx" ON "FiberSegment"("toPointId");

CREATE INDEX IF NOT EXISTS "Closure_buildingId_idx" ON "Closure"("buildingId");
CREATE INDEX IF NOT EXISTS "Splitter_closureId_idx" ON "Splitter"("closureId");
CREATE INDEX IF NOT EXISTS "SplitterOutput_toBuildingId_idx" ON "SplitterOutput"("toBuildingId");

CREATE INDEX IF NOT EXISTS "Lead_buildingId_idx" ON "Lead"("buildingId");
CREATE INDEX IF NOT EXISTS "Lead_createdAt_idx" ON "Lead"("createdAt");
