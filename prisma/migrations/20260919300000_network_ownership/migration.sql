-- Fibers, closures, POPs and splitters become private to whoever made them:
-- only they and an ADMIN can see or change one. This replaces the rule that a
-- POP was visible to everyone assigned its zone.
--
-- The column is nullable on purpose. Existing rows are given an owner below
-- wherever the record allows it; a row nobody can be traced to stays NULL,
-- and a NULL-owner row is ADMIN's alone.

ALTER TABLE "Fiber"    ADD COLUMN "createdById" TEXT;
ALTER TABLE "Closure"  ADD COLUMN "createdById" TEXT;
ALTER TABLE "Pop"      ADD COLUMN "createdById" TEXT;
ALTER TABLE "Splitter" ADD COLUMN "createdById" TEXT;

ALTER TABLE "Fiber"    ADD CONSTRAINT "Fiber_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Closure"  ADD CONSTRAINT "Closure_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Pop"      ADD CONSTRAINT "Pop_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Splitter" ADD CONSTRAINT "Splitter_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Fiber_createdById_idx"    ON "Fiber"("createdById");
CREATE INDEX "Closure_createdById_idx"  ON "Closure"("createdById");
CREATE INDEX "Pop_createdById_idx"      ON "Pop"("createdById");
CREATE INDEX "Splitter_createdById_idx" ON "Splitter"("createdById");

-- ---- Backfill -----------------------------------------------------------
-- 1. Fibers and POPs: the audit log recorded who created each one. The
--    earliest Create entry per record wins; a user since deleted is skipped.
UPDATE "Fiber" f SET "createdById" = src."userId"
FROM (
  SELECT DISTINCT ON (l."recordId") l."recordId", l."userId"
  FROM "SystemLog" l
  WHERE l."module" = 'Fiber' AND l."action" = 'Create'
    AND l."recordId" IS NOT NULL AND l."userId" IS NOT NULL
  ORDER BY l."recordId", l."createdAt" ASC
) src
WHERE src."recordId" = f."id" AND EXISTS (SELECT 1 FROM "User" u WHERE u."id" = src."userId");

UPDATE "Pop" p SET "createdById" = src."userId"
FROM (
  SELECT DISTINCT ON (l."recordId") l."recordId", l."userId"
  FROM "SystemLog" l
  WHERE l."module" = 'Pop' AND l."action" = 'Create'
    AND l."recordId" IS NOT NULL AND l."userId" IS NOT NULL
  ORDER BY l."recordId", l."createdAt" ASC
) src
WHERE src."recordId" = p."id" AND EXISTS (SELECT 1 FROM "User" u WHERE u."id" = src."userId");

-- 2. Closures: owned by the owner of the fiber they sit on (the earliest such
--    fiber). A closure is almost always minted by drawing that fiber.
UPDATE "Closure" c SET "createdById" = src."owner"
FROM (
  SELECT DISTINCT ON (fp."closureId") fp."closureId", f."createdById" AS "owner"
  FROM "FiberPoint" fp JOIN "Fiber" f ON f."id" = fp."fiberId"
  WHERE fp."closureId" IS NOT NULL AND f."createdById" IS NOT NULL
  ORDER BY fp."closureId", f."createdAt" ASC
) src
WHERE src."closureId" = c."id";

--    …and a closure made on its own page still has its own audit entry.
UPDATE "Closure" c SET "createdById" = src."userId"
FROM (
  SELECT DISTINCT ON (l."recordId") l."recordId", l."userId"
  FROM "SystemLog" l
  WHERE l."module" = 'Closure' AND l."action" = 'Create'
    AND l."recordId" IS NOT NULL AND l."userId" IS NOT NULL
  ORDER BY l."recordId", l."createdAt" ASC
) src
WHERE c."createdById" IS NULL AND src."recordId" = c."id"
  AND EXISTS (SELECT 1 FROM "User" u WHERE u."id" = src."userId");

-- 3. Splitters: the owner of the fiber they are a point on, else the owner of
--    the closure they hang off.
UPDATE "Splitter" s SET "createdById" = src."owner"
FROM (
  SELECT DISTINCT ON (fp."splitterId") fp."splitterId", f."createdById" AS "owner"
  FROM "FiberPoint" fp JOIN "Fiber" f ON f."id" = fp."fiberId"
  WHERE fp."splitterId" IS NOT NULL AND f."createdById" IS NOT NULL
  ORDER BY fp."splitterId", f."createdAt" ASC
) src
WHERE src."splitterId" = s."id";

UPDATE "Splitter" s SET "createdById" = c."createdById"
FROM "Closure" c
WHERE s."createdById" IS NULL AND s."closureId" = c."id" AND c."createdById" IS NOT NULL;
