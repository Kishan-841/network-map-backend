-- v2 field-work tracking: a building visit becomes a check-in/check-out session
-- with location + selfie, timestamped activities, and inquiries linked to it.
-- New columns are nullable in the DB (the API enforces what is required); the
-- table is new to production, so nothing is backfilled.

CREATE TYPE "ActivityType" AS ENUM ('DESK', 'UMBRELLA', 'LIFT');

ALTER TABLE "BuildingVisit" ADD COLUMN "checkInLat" DOUBLE PRECISION;
ALTER TABLE "BuildingVisit" ADD COLUMN "checkInLng" DOUBLE PRECISION;
ALTER TABLE "BuildingVisit" ADD COLUMN "selfieUrl" TEXT;
ALTER TABLE "BuildingVisit" ADD COLUMN "checkOutAt" TIMESTAMP(3);
ALTER TABLE "BuildingVisit" ADD COLUMN "checkOutLat" DOUBLE PRECISION;
ALTER TABLE "BuildingVisit" ADD COLUMN "checkOutLng" DOUBLE PRECISION;

CREATE TABLE "VisitActivity" (
    "id" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "type" "ActivityType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VisitActivity_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "VisitActivity_visitId_idx" ON "VisitActivity"("visitId");
ALTER TABLE "VisitActivity" ADD CONSTRAINT "VisitActivity_visitId_fkey"
  FOREIGN KEY ("visitId") REFERENCES "BuildingVisit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CustomerInquiry" ADD COLUMN "visitId" TEXT;
CREATE INDEX "CustomerInquiry_visitId_idx" ON "CustomerInquiry"("visitId");
ALTER TABLE "CustomerInquiry" ADD CONSTRAINT "CustomerInquiry_visitId_fkey"
  FOREIGN KEY ("visitId") REFERENCES "BuildingVisit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
