-- Society permissions, phase 2: admin approval. A society whose permission
-- status becomes ACCEPTED is sent to an ADMIN, who approves it into a zone
-- (it then appears in every staff view like any building) or rejects it with
-- a reason. All columns nullable, no defaults: additive only.
ALTER TABLE "Building" ADD COLUMN "permissionApproval" TEXT;
ALTER TABLE "Building" ADD COLUMN "approvalReason" TEXT;
ALTER TABLE "Building" ADD COLUMN "approvalSubmittedAt" TIMESTAMP(3);
ALTER TABLE "Building" ADD COLUMN "approvalDecidedAt" TIMESTAMP(3);
ALTER TABLE "Building" ADD COLUMN "approvalDecidedById" TEXT;

ALTER TABLE "Building" ADD CONSTRAINT "Building_approvalDecidedById_fkey"
    FOREIGN KEY ("approvalDecidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Building_source_permissionApproval_idx" ON "Building"("source", "permissionApproval");

-- Societies already ACCEPTED when approvals start go straight to the admin's
-- queue, each with one SUBMITTED history row. RETURNING feeds the history, so
-- the rows follow exactly the set that was marked (and a re-run marks none).
WITH submitted AS (
    UPDATE "Building" b
    SET "permissionApproval" = 'PENDING',
        "approvalSubmittedAt" = CURRENT_TIMESTAMP
    FROM "Permission" p
    WHERE p."buildingId" = b."id"
      AND b."source" = 'PERMISSION'
      AND p."permissionStatus" = 'ACCEPTED'
      AND b."permissionApproval" IS NULL
    RETURNING b."id"
)
INSERT INTO "PermissionVisit" ("id", "buildingId", "userId", "remark", "statusBefore", "statusAfter", "changes", "kind", "createdAt")
SELECT gen_random_uuid()::text, s."id", NULL, 'Sent for approval when approvals started',
       NULL, NULL, ARRAY[]::TEXT[], 'SUBMITTED', CURRENT_TIMESTAMP
FROM submitted s;
