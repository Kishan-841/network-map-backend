-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'MANAGER', 'SURVEYOR');

-- CreateEnum
CREATE TYPE "FeasibleStatus" AS ENUM ('FEASIBLE', 'PERMISSION_PENDING', 'REJECTED', 'SURVEY_PENDING');

-- CreateEnum
CREATE TYPE "SurveyStatus" AS ENUM ('PENDING', 'COMPLETED');

-- CreateEnum
CREATE TYPE "PhotoType" AS ENUM ('ENTRANCE', 'PERMISSION_LETTER', 'ADDITIONAL');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'SURVEYOR',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Zone" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Zone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Building" (
    "id" TEXT NOT NULL,
    "placeId" TEXT,
    "buildingName" TEXT NOT NULL,
    "formattedAddress" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "zoneId" TEXT NOT NULL,
    "feasibleStatus" "FeasibleStatus" NOT NULL DEFAULT 'SURVEY_PENDING',
    "surveyStatus" "SurveyStatus" NOT NULL DEFAULT 'PENDING',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Building_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuildingDetails" (
    "id" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "wings" INTEGER,
    "floors" INTEGER,
    "homePass" INTEGER,
    "buildingType" TEXT,
    "remarks" TEXT,

    CONSTRAINT "BuildingDetails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "amountPaid" DECIMAL(12,2),
    "permissionStatus" TEXT,
    "permissionDate" TIMESTAMP(3),
    "renewalDate" TIMESTAMP(3),
    "ownerName" TEXT,
    "ownerMobile" TEXT,
    "documentUrl" TEXT,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Photo" (
    "id" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "type" "PhotoType" NOT NULL,
    "url" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Photo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Zone_name_key" ON "Zone"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Building_placeId_key" ON "Building"("placeId");

-- CreateIndex
CREATE INDEX "Building_latitude_longitude_idx" ON "Building"("latitude", "longitude");

-- CreateIndex
CREATE UNIQUE INDEX "BuildingDetails_buildingId_key" ON "BuildingDetails"("buildingId");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_buildingId_key" ON "Permission"("buildingId");

-- AddForeignKey
ALTER TABLE "Building" ADD CONSTRAINT "Building_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Building" ADD CONSTRAINT "Building_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildingDetails" ADD CONSTRAINT "BuildingDetails_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Permission" ADD CONSTRAINT "Permission_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;
