-- POP → zones becomes a Prisma implicit many-to-many (mirrors User.assignedZones).
-- Join-table shape confirmed via `prisma migrate diff`.

-- CreateTable
CREATE TABLE "_PopZones" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_PopZones_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_PopZones_B_index" ON "_PopZones"("B");

-- AddForeignKey
ALTER TABLE "_PopZones" ADD CONSTRAINT "_PopZones_A_fkey" FOREIGN KEY ("A") REFERENCES "Pop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PopZones" ADD CONSTRAINT "_PopZones_B_fkey" FOREIGN KEY ("B") REFERENCES "Zone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: each POP's single zone becomes one join row
INSERT INTO "_PopZones" ("A", "B")
SELECT "id", "zoneId" FROM "Pop" WHERE "zoneId" IS NOT NULL;

-- Drop the old single-zone column + FK
ALTER TABLE "Pop" DROP CONSTRAINT IF EXISTS "Pop_zoneId_fkey";
ALTER TABLE "Pop" DROP COLUMN "zoneId";
