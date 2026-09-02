-- Call logging on leads. Additive only.

CREATE TYPE "CallOutcome" AS ENUM ('INTERESTED', 'CALL_LATER', 'NOT_REACHABLE', 'WRONG_NUMBER');

CREATE TABLE "LeadCall" (
    "id"              TEXT NOT NULL,
    "leadId"          TEXT NOT NULL,
    "byUserId"        TEXT,
    "startedAt"       TIMESTAMP(3) NOT NULL,
    "endedAt"         TIMESTAMP(3) NOT NULL,
    -- Stored, not recomputed: a clock change must not rewrite how long a
    -- past call took.
    "durationSeconds" INTEGER NOT NULL,
    "outcome"         "CallOutcome" NOT NULL,
    "callbackAt"      TIMESTAMP(3),
    "note"            TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadCall_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LeadCall_leadId_idx" ON "LeadCall"("leadId");
CREATE INDEX "LeadCall_byUserId_idx" ON "LeadCall"("byUserId");

ALTER TABLE "LeadCall" ADD CONSTRAINT "LeadCall_leadId_fkey"
    FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- SET NULL: the call record outlives the person who made it.
ALTER TABLE "LeadCall" ADD CONSTRAINT "LeadCall_byUserId_fkey"
    FOREIGN KEY ("byUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Kept on the lead so "who is due a callback today" is one indexed query
-- rather than a scan of every call ever made.
ALTER TABLE "Lead" ADD COLUMN "nextCallAt" TIMESTAMP(3);
CREATE INDEX "Lead_nextCallAt_idx" ON "Lead"("nextCallAt");
