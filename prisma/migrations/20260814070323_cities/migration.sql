-- CreateTable
CREATE TABLE "City" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "City_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "City_name_key" ON "City"("name");

-- AlterTable
ALTER TABLE "Operator" ADD COLUMN "cityId" TEXT;

-- AddForeignKey
ALTER TABLE "Operator" ADD CONSTRAINT "Operator_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: one City per distinct (case-insensitive, trimmed) operator city.
INSERT INTO "City" ("id", "name", "updatedAt")
SELECT gen_random_uuid()::text, s.trimmed, CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT ON (lower(trim("city"))) trim("city") AS trimmed
  FROM "Operator"
  WHERE "city" IS NOT NULL AND trim("city") <> ''
  ORDER BY lower(trim("city")), trim("city")
) s;

UPDATE "Operator" o
SET "cityId" = c."id"
FROM "City" c
WHERE o."city" IS NOT NULL AND lower(trim(o."city")) = lower(c."name");

-- The string column is now fully represented by the City link.
ALTER TABLE "Operator" DROP COLUMN "city";
