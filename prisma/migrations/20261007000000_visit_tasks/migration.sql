-- Field-sales visit plan: one row per person / building / IST day.
CREATE TABLE "TaskUpload" (
    "id" TEXT NOT NULL,
    "uploadedById" TEXT,
    "fromDate" DATE NOT NULL,
    "toDate" DATE NOT NULL,
    "assigneeCount" INTEGER NOT NULL,
    "created" INTEGER NOT NULL,
    "replaced" INTEGER NOT NULL,
    "assigned" INTEGER NOT NULL,
    "fileName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskUpload_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "TaskUpload" ADD CONSTRAINT "TaskUpload_uploadedById_fkey"
    FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "VisitTask" (
    "id" TEXT NOT NULL,
    "assigneeId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "taskDate" DATE NOT NULL,
    "startTime" TEXT,
    "endTime" TEXT,
    "uploadId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VisitTask_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "VisitTask_assigneeId_taskDate_idx" ON "VisitTask"("assigneeId", "taskDate");
CREATE INDEX "VisitTask_taskDate_idx" ON "VisitTask"("taskDate");
ALTER TABLE "VisitTask" ADD CONSTRAINT "VisitTask_assigneeId_fkey"
    FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VisitTask" ADD CONSTRAINT "VisitTask_buildingId_fkey"
    FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VisitTask" ADD CONSTRAINT "VisitTask_uploadId_fkey"
    FOREIGN KEY ("uploadId") REFERENCES "TaskUpload"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VisitTask" ADD CONSTRAINT "VisitTask_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
