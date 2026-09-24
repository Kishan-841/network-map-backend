-- Field-sales foundations: three new roles, a manager/team-leader chain on
-- User, and per-building assignment. Existing buildings are reused; nothing
-- here touches coverage or acquisition data. New enum values are added first
-- (a value cannot be used in the same statement that adds it).

ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'SALES_MANAGER';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'TEAM_LEADER';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'SALES_EXECUTIVE';

CREATE TYPE "AssignmentStatus" AS ENUM ('ACTIVE', 'REASSIGNED', 'UNASSIGNED');

-- Sales hierarchy on User (nullable; unused for every non-sales role).
ALTER TABLE "User" ADD COLUMN "managerId" TEXT;
ALTER TABLE "User" ADD COLUMN "teamLeaderId" TEXT;
ALTER TABLE "User" ADD CONSTRAINT "User_managerId_fkey"
  FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "User" ADD CONSTRAINT "User_teamLeaderId_fkey"
  FOREIGN KEY ("teamLeaderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "User_managerId_idx" ON "User"("managerId");
CREATE INDEX "User_teamLeaderId_idx" ON "User"("teamLeaderId");

-- Per-building assignment. One ACTIVE row per building = its current holder.
CREATE TABLE "BuildingAssignment" (
    "id" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "assignedToId" TEXT NOT NULL,
    "assignedById" TEXT NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    CONSTRAINT "BuildingAssignment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "BuildingAssignment_buildingId_status_idx" ON "BuildingAssignment"("buildingId", "status");
CREATE INDEX "BuildingAssignment_assignedToId_status_idx" ON "BuildingAssignment"("assignedToId", "status");
ALTER TABLE "BuildingAssignment" ADD CONSTRAINT "BuildingAssignment_buildingId_fkey"
  FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BuildingAssignment" ADD CONSTRAINT "BuildingAssignment_assignedToId_fkey"
  FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BuildingAssignment" ADD CONSTRAINT "BuildingAssignment_assignedById_fkey"
  FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
