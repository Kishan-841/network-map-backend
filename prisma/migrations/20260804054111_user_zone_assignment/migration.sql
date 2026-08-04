-- CreateTable
CREATE TABLE "_UserAssignedZones" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_UserAssignedZones_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_UserAssignedZones_B_index" ON "_UserAssignedZones"("B");

-- AddForeignKey
ALTER TABLE "_UserAssignedZones" ADD CONSTRAINT "_UserAssignedZones_A_fkey" FOREIGN KEY ("A") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_UserAssignedZones" ADD CONSTRAINT "_UserAssignedZones_B_fkey" FOREIGN KEY ("B") REFERENCES "Zone"("id") ON DELETE CASCADE ON UPDATE CASCADE;
