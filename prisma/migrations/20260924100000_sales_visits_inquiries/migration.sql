-- Phase 2 of field sales: building visits and customer inquiries. Both hang off
-- existing buildings and sales users; a visit and an inquiry are separate
-- activities and are counted separately.

CREATE TABLE "BuildingVisit" (
    "id" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "visitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    CONSTRAINT "BuildingVisit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "BuildingVisit_userId_visitedAt_idx" ON "BuildingVisit"("userId", "visitedAt");
CREATE INDEX "BuildingVisit_buildingId_idx" ON "BuildingVisit"("buildingId");
ALTER TABLE "BuildingVisit" ADD CONSTRAINT "BuildingVisit_buildingId_fkey"
  FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BuildingVisit" ADD CONSTRAINT "BuildingVisit_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "CustomerInquiry" (
    "id" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "address" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomerInquiry_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CustomerInquiry_buildingId_idx" ON "CustomerInquiry"("buildingId");
CREATE INDEX "CustomerInquiry_createdById_createdAt_idx" ON "CustomerInquiry"("createdById", "createdAt");
ALTER TABLE "CustomerInquiry" ADD CONSTRAINT "CustomerInquiry_buildingId_fkey"
  FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerInquiry" ADD CONSTRAINT "CustomerInquiry_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
