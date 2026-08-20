-- CreateEnum
CREATE TYPE "BuildingSource" AS ENUM ('COVERAGE', 'ACQUISITION');

-- CreateEnum
CREATE TYPE "ContactDesignation" AS ENUM ('CHAIRMAN', 'SECRETARY', 'MANAGER', 'OWNER', 'TREASURER', 'COMMITTEE_MEMBER', 'WATCHMAN', 'OTHER');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PhotoType" ADD VALUE 'SELFIE';
ALTER TYPE "PhotoType" ADD VALUE 'CONTACT_PERSON';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "Role" ADD VALUE 'ACQUISITION_AGENT';
ALTER TYPE "Role" ADD VALUE 'ACQUISITION_LEAD';

-- DropForeignKey
ALTER TABLE "Building" DROP CONSTRAINT "Building_zoneId_fkey";

-- AlterTable
ALTER TABLE "Building" ADD COLUMN     "cityId" TEXT,
ADD COLUMN     "pincode" TEXT,
ADD COLUMN     "source" "BuildingSource" NOT NULL DEFAULT 'COVERAGE',
ALTER COLUMN "zoneId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "UserPincode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cityId" TEXT NOT NULL,
    "pincode" TEXT NOT NULL,

    CONSTRAINT "UserPincode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuildingContact" (
    "id" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "contactEmail" TEXT,
    "designation" "ContactDesignation" NOT NULL,
    "designationOther" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuildingContact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserPincode_cityId_idx" ON "UserPincode"("cityId");

-- CreateIndex
CREATE UNIQUE INDEX "UserPincode_userId_pincode_key" ON "UserPincode"("userId", "pincode");

-- CreateIndex
CREATE UNIQUE INDEX "BuildingContact_buildingId_key" ON "BuildingContact"("buildingId");

-- CreateIndex
CREATE INDEX "Building_source_createdById_idx" ON "Building"("source", "createdById");

-- AddForeignKey
ALTER TABLE "UserPincode" ADD CONSTRAINT "UserPincode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPincode" ADD CONSTRAINT "UserPincode_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Building" ADD CONSTRAINT "Building_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Building" ADD CONSTRAINT "Building_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildingContact" ADD CONSTRAINT "BuildingContact_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;
