-- Society permissions, phase 3: site survey + material request. One survey per
-- approved society: the zone's surveyor checks the society, records its wings,
-- the links between them and the material it needs; an ADMIN approves the
-- material request (or rejects it with a reason). Additive only: a new table.
CREATE TABLE "SocietySurvey" (
    "id" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "checks" JSONB NOT NULL DEFAULT '{}',
    "wings" JSONB NOT NULL DEFAULT '[]',
    "links" JSONB NOT NULL DEFAULT '[]',
    "materials" JSONB NOT NULL DEFAULT '{}',
    "rejectReason" TEXT,
    "submittedAt" TIMESTAMP(3),
    "submittedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocietySurvey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SocietySurvey_buildingId_key" ON "SocietySurvey"("buildingId");
CREATE INDEX "SocietySurvey_status_idx" ON "SocietySurvey"("status");

ALTER TABLE "SocietySurvey" ADD CONSTRAINT "SocietySurvey_buildingId_fkey"
    FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SocietySurvey" ADD CONSTRAINT "SocietySurvey_submittedById_fkey"
    FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SocietySurvey" ADD CONSTRAINT "SocietySurvey_decidedById_fkey"
    FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
