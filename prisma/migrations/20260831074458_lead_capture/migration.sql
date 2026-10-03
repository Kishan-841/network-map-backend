-- CreateEnum
CREATE TYPE "BuildingMatch" AS ENUM ('LIVE', 'IN_REGISTRY', 'NOT_FOUND');

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "buildingMatch" "BuildingMatch",
ADD COLUMN     "requirementMbps" INTEGER,
ADD COLUMN     "searchedPlaceId" TEXT,
ADD COLUMN     "searchedPlaceName" TEXT;
