-- Partner earnings: one row per converted lead.
--
-- Additive only. No existing row is touched, so the migration is safe to run
-- against the live registry.

CREATE TYPE "EarningStatus" AS ENUM ('AWAITING_PAYMENT', 'PAID');

CREATE TABLE "PartnerEarning" (
    "id"            TEXT NOT NULL,
    "partnerId"     TEXT NOT NULL,
    "leadId"        TEXT NOT NULL,
    "employeeId"    TEXT,
    "speedMbps"     INTEGER NOT NULL,
    "billingPeriod" "BillingPeriod" NOT NULL,
    "amount"        INTEGER NOT NULL,
    "earnedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status"        "EarningStatus" NOT NULL DEFAULT 'AWAITING_PAYMENT',
    "paidAt"        TIMESTAMP(3),
    "paidById"      TEXT,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerEarning_pkey" PRIMARY KEY ("id")
);

-- One earning per lead. This constraint IS the no-double-pay rule: a second
-- conversion of the same customer cannot create a second payment.
CREATE UNIQUE INDEX "PartnerEarning_leadId_key" ON "PartnerEarning"("leadId");

CREATE INDEX "PartnerEarning_partnerId_earnedAt_idx" ON "PartnerEarning"("partnerId", "earnedAt");
CREATE INDEX "PartnerEarning_employeeId_idx" ON "PartnerEarning"("employeeId");
CREATE INDEX "PartnerEarning_status_idx" ON "PartnerEarning"("status");

ALTER TABLE "PartnerEarning" ADD CONSTRAINT "PartnerEarning_partnerId_fkey"
    FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartnerEarning" ADD CONSTRAINT "PartnerEarning_leadId_fkey"
    FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Attribution survives the employee leaving: the row stays, the link goes null.
ALTER TABLE "PartnerEarning" ADD CONSTRAINT "PartnerEarning_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PartnerEarning" ADD CONSTRAINT "PartnerEarning_paidById_fkey"
    FOREIGN KEY ("paidById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
