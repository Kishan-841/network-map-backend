-- Enums
CREATE TYPE "FiberPointType"   AS ENUM ('WAYPOINT', 'POP', 'CLOSURE', 'BUILDING');
CREATE TYPE "FiberStatus"      AS ENUM ('PLANNED', 'LIVE', 'CUT');
CREATE TYPE "SplitterRatio"    AS ENUM ('R1_2', 'R1_4', 'R1_8', 'R1_16');
CREATE TYPE "SplitterLocation" AS ENUM ('WAN', 'LAN');

-- Tables
CREATE TABLE "Pop" (
  "id" TEXT NOT NULL, "name" TEXT NOT NULL, "latitude" DOUBLE PRECISION NOT NULL, "longitude" DOUBLE PRECISION NOT NULL,
  "notes" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Pop_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "Pop_name_key" ON "Pop"("name");

CREATE TABLE "Olt" (
  "id" TEXT NOT NULL, "popId" TEXT NOT NULL, "name" TEXT NOT NULL, "ponPortCount" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Olt_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "Olt_popId_name_key" ON "Olt"("popId", "name");
ALTER TABLE "Olt" ADD CONSTRAINT "Olt_popId_fkey" FOREIGN KEY ("popId") REFERENCES "Pop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Closure" (
  "id" TEXT NOT NULL, "code" TEXT NOT NULL, "latitude" DOUBLE PRECISION NOT NULL, "longitude" DOUBLE PRECISION NOT NULL,
  "kind" TEXT, "buildingId" TEXT, "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Closure_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "Closure_code_key" ON "Closure"("code");
ALTER TABLE "Closure" ADD CONSTRAINT "Closure_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "Fiber" (
  "id" TEXT NOT NULL, "name" TEXT NOT NULL, "coreCount" INTEGER NOT NULL, "cableType" TEXT,
  "status" "FiberStatus" NOT NULL DEFAULT 'PLANNED', "oltId" TEXT, "ponPort" INTEGER,
  "cableTag" TEXT, "placement" TEXT, "operatorId" TEXT, "notes" TEXT, "images" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Fiber_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "Fiber_name_key" ON "Fiber"("name");
CREATE UNIQUE INDEX "Fiber_oltId_ponPort_key" ON "Fiber"("oltId", "ponPort");
ALTER TABLE "Fiber" ADD CONSTRAINT "Fiber_oltId_fkey" FOREIGN KEY ("oltId") REFERENCES "Olt"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Fiber" ADD CONSTRAINT "Fiber_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "Operator"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "FiberPoint" (
  "id" TEXT NOT NULL, "fiberId" TEXT NOT NULL, "sequence" INTEGER NOT NULL,
  "type" "FiberPointType" NOT NULL DEFAULT 'WAYPOINT',
  "latitude" DOUBLE PRECISION NOT NULL, "longitude" DOUBLE PRECISION NOT NULL,
  "popId" TEXT, "closureId" TEXT, "buildingId" TEXT,
  CONSTRAINT "FiberPoint_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "FiberPoint_fiberId_sequence_key" ON "FiberPoint"("fiberId", "sequence");
CREATE INDEX "FiberPoint_closureId_idx"  ON "FiberPoint"("closureId");
CREATE INDEX "FiberPoint_popId_idx"      ON "FiberPoint"("popId");
CREATE INDEX "FiberPoint_buildingId_idx" ON "FiberPoint"("buildingId");
ALTER TABLE "FiberPoint" ADD CONSTRAINT "FiberPoint_fiberId_fkey"    FOREIGN KEY ("fiberId")    REFERENCES "Fiber"("id")    ON DELETE CASCADE  ON UPDATE CASCADE;
ALTER TABLE "FiberPoint" ADD CONSTRAINT "FiberPoint_popId_fkey"      FOREIGN KEY ("popId")      REFERENCES "Pop"("id")      ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FiberPoint" ADD CONSTRAINT "FiberPoint_closureId_fkey"  FOREIGN KEY ("closureId")  REFERENCES "Closure"("id")  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FiberPoint" ADD CONSTRAINT "FiberPoint_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "FiberSegment" (
  "id" TEXT NOT NULL, "fiberId" TEXT NOT NULL, "sequence" INTEGER NOT NULL,
  "fromPointId" TEXT NOT NULL, "toPointId" TEXT NOT NULL,
  "mapMeters" DOUBLE PRECISION NOT NULL, "fiberLaidMeters" DOUBLE PRECISION,
  "isCut" BOOLEAN NOT NULL DEFAULT false, "cutAt" TIMESTAMP(3), "cutNote" TEXT,
  CONSTRAINT "FiberSegment_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "FiberSegment_fiberId_sequence_key" ON "FiberSegment"("fiberId", "sequence");
ALTER TABLE "FiberSegment" ADD CONSTRAINT "FiberSegment_fiberId_fkey"     FOREIGN KEY ("fiberId")     REFERENCES "Fiber"("id")      ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FiberSegment" ADD CONSTRAINT "FiberSegment_fromPointId_fkey" FOREIGN KEY ("fromPointId") REFERENCES "FiberPoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FiberSegment" ADD CONSTRAINT "FiberSegment_toPointId_fkey"   FOREIGN KEY ("toPointId")   REFERENCES "FiberPoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Splitter" (
  "id" TEXT NOT NULL, "closureId" TEXT NOT NULL, "ratio" "SplitterRatio" NOT NULL,
  "location" "SplitterLocation" NOT NULL DEFAULT 'WAN', "inputFiberId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Splitter_pkey" PRIMARY KEY ("id"));
CREATE INDEX "Splitter_inputFiberId_idx" ON "Splitter"("inputFiberId");
ALTER TABLE "Splitter" ADD CONSTRAINT "Splitter_closureId_fkey"    FOREIGN KEY ("closureId")    REFERENCES "Closure"("id") ON DELETE CASCADE  ON UPDATE CASCADE;
ALTER TABLE "Splitter" ADD CONSTRAINT "Splitter_inputFiberId_fkey" FOREIGN KEY ("inputFiberId") REFERENCES "Fiber"("id")   ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "SplitterOutput" (
  "id" TEXT NOT NULL, "splitterId" TEXT NOT NULL, "portNo" INTEGER NOT NULL,
  "toFiberId" TEXT, "toBuildingId" TEXT, "label" TEXT,
  CONSTRAINT "SplitterOutput_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "SplitterOutput_splitterId_portNo_key" ON "SplitterOutput"("splitterId", "portNo");
CREATE UNIQUE INDEX "SplitterOutput_toFiberId_key" ON "SplitterOutput"("toFiberId");
ALTER TABLE "SplitterOutput" ADD CONSTRAINT "SplitterOutput_splitterId_fkey"   FOREIGN KEY ("splitterId")   REFERENCES "Splitter"("id") ON DELETE CASCADE  ON UPDATE CASCADE;
ALTER TABLE "SplitterOutput" ADD CONSTRAINT "SplitterOutput_toFiberId_fkey"    FOREIGN KEY ("toFiberId")    REFERENCES "Fiber"("id")    ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SplitterOutput" ADD CONSTRAINT "SplitterOutput_toBuildingId_fkey" FOREIGN KEY ("toBuildingId") REFERENCES "Building"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Auto codes (race-free; see spec §2.8)
CREATE SEQUENCE "Fiber_name_seq"   START 1;
CREATE SEQUENCE "Closure_code_seq" START 1;

-- Data move: each phase-1 FiberRoute SEGMENT becomes one Fiber (spec §2.14).
INSERT INTO "Fiber" ("id", "name", "coreCount", "cableTag", "placement", "operatorId", "notes", "images", "status", "createdAt", "updatedAt")
SELECT
  fr."id" || '-' || s.ord,
  CASE WHEN cnt.n = 1 THEN fr."name" ELSE fr."name" || ' / ' || s.ord END,
  COALESCE(NULLIF(regexp_replace(s.seg->>'fiberType', '\D', '', 'g'), '')::int, 2),
  fr."fiberId", fr."placement", fr."operatorId", fr."remark", fr."images", 'PLANNED', fr."createdAt", fr."updatedAt"
FROM "FiberRoute" fr
CROSS JOIN LATERAL jsonb_array_elements(fr."segments") WITH ORDINALITY AS s(seg, ord)
CROSS JOIN LATERAL (SELECT jsonb_array_length(fr."segments") AS n) AS cnt;

INSERT INTO "FiberPoint" ("id", "fiberId", "sequence", "type", "latitude", "longitude")
SELECT
  fr."id" || '-' || s.ord || '-p' || p.ord,
  fr."id" || '-' || s.ord,
  (p.ord - 1)::int, 'WAYPOINT',
  (p.pt->>'latitude')::double precision, (p.pt->>'longitude')::double precision
FROM "FiberRoute" fr
CROSS JOIN LATERAL jsonb_array_elements(fr."segments") WITH ORDINALITY AS s(seg, ord)
CROSS JOIN LATERAL jsonb_array_elements(s.seg->'points') WITH ORDINALITY AS p(pt, ord);
