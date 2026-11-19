-- Closure In / Out cables: any number per closure (additive; old columns stay).
CREATE TABLE "ClosureCable" (
    "id" TEXT NOT NULL,
    "closureId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "cableType" TEXT,
    "coreCount" INTEGER,
    "cableTag" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClosureCable_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ClosureCable_closureId_idx" ON "ClosureCable"("closureId");
CREATE INDEX "ClosureCable_cableTag_idx" ON "ClosureCable"("cableTag");

ALTER TABLE "ClosureCable" ADD CONSTRAINT "ClosureCable_closureId_fkey"
    FOREIGN KEY ("closureId") REFERENCES "Closure"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Carry the old single sheet over: one IN row (cable type + core in), one OUT row (cable type + core out).
INSERT INTO "ClosureCable" ("id", "closureId", "direction", "cableType", "coreCount", "position")
SELECT 'cc' || md5("id" || ':in'), "id", 'IN', "fiberType", "inCoreCount", 0
FROM "Closure"
WHERE "fiberType" IS NOT NULL OR "inCoreCount" IS NOT NULL;

INSERT INTO "ClosureCable" ("id", "closureId", "direction", "cableType", "coreCount", "position")
SELECT 'cc' || md5("id" || ':out'), "id", 'OUT', "fiberType", "outCoreCount", 0
FROM "Closure"
WHERE "outCoreCount" IS NOT NULL;
