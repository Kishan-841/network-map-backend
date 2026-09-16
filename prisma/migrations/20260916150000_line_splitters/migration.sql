-- Postgres refuses to USE an enum value added in the same transaction as the
-- statement that adds it, so both ADD VALUEs come first and nothing below
-- references them.
ALTER TYPE "FiberPointType" ADD VALUE 'SPLITTER';
ALTER TYPE "SplitterRatio" ADD VALUE 'R1_6';

-- A splitter is now a point on the line in its own right: it carries its own
-- code (S1, S2…) and position, and the closure it used to hang off is optional.
CREATE SEQUENCE "Splitter_code_seq" START 1;

ALTER TABLE "Splitter" ADD COLUMN "code" TEXT,
                       ADD COLUMN "latitude" DOUBLE PRECISION,
                       ADD COLUMN "longitude" DOUBLE PRECISION;
ALTER TABLE "Splitter" ALTER COLUMN "closureId" DROP NOT NULL;

-- Existing splitters sit on a closure — they inherit its position and take the
-- next code in the sequence.
UPDATE "Splitter" s
   SET "code" = 'S' || nextval('"Splitter_code_seq"'),
       "latitude" = c."latitude",
       "longitude" = c."longitude"
  FROM "Closure" c
 WHERE s."closureId" = c."id" AND s."code" IS NULL;

ALTER TABLE "Splitter" ALTER COLUMN "code" SET NOT NULL,
                       ALTER COLUMN "latitude" SET NOT NULL,
                       ALTER COLUMN "longitude" SET NOT NULL;
CREATE UNIQUE INDEX "Splitter_code_key" ON "Splitter"("code");

-- RESTRICT, like the other typed-point references: a splitter a line still
-- passes through cannot be deleted out from under it.
ALTER TABLE "FiberPoint" ADD COLUMN "splitterId" TEXT;
CREATE INDEX "FiberPoint_splitterId_idx" ON "FiberPoint"("splitterId");
ALTER TABLE "FiberPoint" ADD CONSTRAINT "FiberPoint_splitterId_fkey"
  FOREIGN KEY ("splitterId") REFERENCES "Splitter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
