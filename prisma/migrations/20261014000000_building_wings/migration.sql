-- Building wings (spec 2026-10-14). Additive only.
CREATE TABLE "BuildingWing" (
    "id" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "homePass" INTEGER NOT NULL DEFAULT 0,
    "isLive" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BuildingWing_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "BuildingWing_buildingId_idx" ON "BuildingWing"("buildingId");
-- One name per building, case-insensitive (Prisma cannot express this index).
CREATE UNIQUE INDEX "BuildingWing_buildingId_lower_name_key" ON "BuildingWing"("buildingId", lower("name"));
ALTER TABLE "BuildingWing" ADD CONSTRAINT "BuildingWing_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BuildingWing" ADD CONSTRAINT "BuildingWing_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
