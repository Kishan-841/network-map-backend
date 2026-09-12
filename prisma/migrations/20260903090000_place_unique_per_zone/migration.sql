-- The same building may exist under more than one zone.
--
-- placeId was globally unique, so once a building was added under Zone A
-- nobody could add it under Zone B — but two operators can genuinely serve
-- the same building, and each needs it in their own zone.
--
-- Replaced with one row per place PER ZONE. Written as an expression index
-- because Prisma cannot express either half of what this needs:
--
--   COALESCE(zoneId, '')  — in Postgres a NULL never equals a NULL, so a
--     plain UNIQUE(placeId, zoneId) would let unlimited duplicates through
--     for rows with no zone. Acquisition buildings have no zone, and they
--     must keep the protection they have today.
--
--   WHERE placeId IS NOT NULL — buildings added without a Place id (bulk
--     import, manual entry) are not constrained at all, as before.

DROP INDEX IF EXISTS "Building_placeId_key";

CREATE UNIQUE INDEX "Building_placeId_zone_key"
    ON "Building" ("placeId", COALESCE("zoneId", ''))
    WHERE "placeId" IS NOT NULL;
