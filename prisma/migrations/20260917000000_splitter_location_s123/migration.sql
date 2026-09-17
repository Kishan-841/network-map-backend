-- The splitter "location" picker now offers S1 / S2 / S3 instead of WAN / LAN.
-- Existing rows keep their meaning: network-side WAN -> S1, building-side LAN -> S2.
ALTER TYPE "SplitterLocation" RENAME VALUE 'WAN' TO 'S1';
ALTER TYPE "SplitterLocation" RENAME VALUE 'LAN' TO 'S2';
ALTER TYPE "SplitterLocation" ADD VALUE 'S3';
ALTER TABLE "Splitter" ALTER COLUMN "location" SET DEFAULT 'S1';