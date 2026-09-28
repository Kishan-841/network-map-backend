-- AlterTable
ALTER TABLE "BuildingVisit" ADD COLUMN "wentSolo" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "VisitCompanion" (
    "id" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "VisitCompanion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VisitCompanion_visitId_userId_key" ON "VisitCompanion"("visitId", "userId");

-- CreateIndex
CREATE INDEX "VisitCompanion_userId_idx" ON "VisitCompanion"("userId");

-- AddForeignKey
ALTER TABLE "VisitCompanion" ADD CONSTRAINT "VisitCompanion_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "BuildingVisit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitCompanion" ADD CONSTRAINT "VisitCompanion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
