-- The survey sheet also records what make each box is, and how fast:
-- a switch is 1G or 10G, an OLT is GPON or EPON, and both carry a model number.
-- All nullable — the sheet is often completed on a second visit.
ALTER TABLE "Olt" ADD COLUMN "type" TEXT;
ALTER TABLE "Olt" ADD COLUMN "model" TEXT;
ALTER TABLE "PopDevice" ADD COLUMN "speed" TEXT;
ALTER TABLE "PopDevice" ADD COLUMN "model" TEXT;
