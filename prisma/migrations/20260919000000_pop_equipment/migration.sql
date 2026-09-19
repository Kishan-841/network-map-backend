-- A POP is a room with equipment in it, not just a pin: the survey sheet
-- records the rack, the boxes in it and their addresses.
-- Every column is nullable and every device is a new row, so the POPs recorded
-- before this stay exactly as they are until somebody fills the rest in.
ALTER TABLE "Pop" ADD COLUMN "serverLocation" TEXT;
ALTER TABLE "Pop" ADD COLUMN "rackSize" TEXT;
ALTER TABLE "Pop" ADD COLUMN "rackCondition" TEXT;
ALTER TABLE "Pop" ADD COLUMN "upsBatteryCount" INTEGER;
ALTER TABLE "Pop" ADD COLUMN "images" JSONB;

-- OLTs already exist as rows; the sheet also wants their address.
ALTER TABLE "Olt" ADD COLUMN "ipAddress" TEXT;

CREATE TYPE "PopDeviceKind" AS ENUM ('SWITCH', 'MIKROTIK', 'FMS');

CREATE TABLE "PopDevice" (
  "id"        TEXT NOT NULL,
  "popId"     TEXT NOT NULL,
  "kind"      "PopDeviceKind" NOT NULL,
  "label"     TEXT,
  "ipAddress" TEXT,
  "portCount" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PopDevice_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PopDevice_popId_idx" ON "PopDevice"("popId");
ALTER TABLE "PopDevice" ADD CONSTRAINT "PopDevice_popId_fkey"
  FOREIGN KEY ("popId") REFERENCES "Pop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
