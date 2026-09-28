-- A building may map to several PON ports on its OLT (comma-separated in the UI).
ALTER TABLE "Building" ADD COLUMN "ponPorts" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];

-- Backfill: the single existing port becomes a one-element list
UPDATE "Building" SET "ponPorts" = ARRAY["ponPort"] WHERE "ponPort" IS NOT NULL;

-- Drop the old single-port column
ALTER TABLE "Building" DROP COLUMN "ponPort";
