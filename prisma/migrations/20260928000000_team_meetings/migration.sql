-- CreateTable
CREATE TABLE "TeamMeeting" (
    "id" TEXT NOT NULL,
    "teamLeaderId" TEXT NOT NULL,
    "meetingDate" DATE NOT NULL,
    "photoUrl" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamMeeting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TeamMeeting_teamLeaderId_meetingDate_key" ON "TeamMeeting"("teamLeaderId", "meetingDate");

-- AddForeignKey
ALTER TABLE "TeamMeeting" ADD CONSTRAINT "TeamMeeting_teamLeaderId_fkey" FOREIGN KEY ("teamLeaderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
