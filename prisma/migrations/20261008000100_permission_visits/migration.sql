-- Society permissions (phase 1): the visit / edit history under each
-- PERMISSION building. Append-only; a remark is compulsory on every row.
CREATE TABLE "PermissionVisit" (
    "id" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "userId" TEXT,
    "remark" TEXT NOT NULL,
    "statusBefore" TEXT,
    "statusAfter" TEXT,
    "changes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "kind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PermissionVisit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PermissionVisit_buildingId_createdAt_idx" ON "PermissionVisit"("buildingId", "createdAt");
ALTER TABLE "PermissionVisit" ADD CONSTRAINT "PermissionVisit_buildingId_fkey"
    FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PermissionVisit" ADD CONSTRAINT "PermissionVisit_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Every society a Permission Executive already added moves into the new
-- registry. Only COVERAGE rows: roles are mutable, so a user who is a PE today
-- may have logged ACQUISITION buildings under an earlier role — those stay put.
-- RETURNING feeds the backfill, so the history rows follow exactly the moved set.
WITH moved AS (
    UPDATE "Building" b
    SET "source" = 'PERMISSION'
    FROM "User" u
    WHERE u."id" = b."createdById"
      AND u."role" = 'PERMISSION_EXECUTIVE'
      AND b."source" = 'COVERAGE'
    RETURNING b."id", b."createdById", b."createdAt"
)
-- One history row per moved building, so no society starts with an empty history.
INSERT INTO "PermissionVisit" ("id", "buildingId", "userId", "remark", "statusBefore", "statusAfter", "changes", "kind", "createdAt")
SELECT gen_random_uuid()::text, m."id", m."createdById", 'Added before visit history was recorded',
       NULL, p."permissionStatus", ARRAY[]::TEXT[], 'ADDED', m."createdAt"
FROM moved m
LEFT JOIN "Permission" p ON p."buildingId" = m."id";
