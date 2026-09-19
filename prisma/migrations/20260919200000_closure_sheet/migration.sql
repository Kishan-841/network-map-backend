-- The closure survey sheet: which kind of cable the closure sits on, how many
-- tubes that cable has, and the cores coming in and going out.
-- All nullable — the closures already recorded keep their code, position and
-- kind, and the rest is filled in on the next visit.
ALTER TABLE "Closure" ADD COLUMN "fiberType" TEXT;
ALTER TABLE "Closure" ADD COLUMN "tubeCount" INTEGER;
ALTER TABLE "Closure" ADD COLUMN "inCoreCount" INTEGER;
ALTER TABLE "Closure" ADD COLUMN "outCoreCount" INTEGER;
