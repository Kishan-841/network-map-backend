-- Partner-to-partner introductions (partner-network.md §7). Additive only.

CREATE TYPE "PartnerReferralStatus" AS ENUM ('NEW', 'CONTACTED', 'JOINED', 'DECLINED');

CREATE TABLE "PartnerReferral" (
    "id"              TEXT NOT NULL,
    "referredById"    TEXT NOT NULL,
    "employeeId"      TEXT,
    "name"            TEXT NOT NULL,
    "type"            "PartnerType" NOT NULL,
    "mobile"          TEXT NOT NULL,
    "email"           TEXT,
    "note"            TEXT,
    "status"          "PartnerReferralStatus" NOT NULL DEFAULT 'NEW',
    "joinedPartnerId" TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerReferral_pkey" PRIMARY KEY ("id")
);

-- One introduction can only ever become one partner.
CREATE UNIQUE INDEX "PartnerReferral_joinedPartnerId_key" ON "PartnerReferral"("joinedPartnerId");

CREATE INDEX "PartnerReferral_referredById_idx" ON "PartnerReferral"("referredById");
CREATE INDEX "PartnerReferral_employeeId_idx" ON "PartnerReferral"("employeeId");
CREATE INDEX "PartnerReferral_status_idx" ON "PartnerReferral"("status");
-- Duplicate introductions are looked up by number.
CREATE INDEX "PartnerReferral_mobile_idx" ON "PartnerReferral"("mobile");

ALTER TABLE "PartnerReferral" ADD CONSTRAINT "PartnerReferral_referredById_fkey"
    FOREIGN KEY ("referredById") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartnerReferral" ADD CONSTRAINT "PartnerReferral_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PartnerReferral" ADD CONSTRAINT "PartnerReferral_joinedPartnerId_fkey"
    FOREIGN KEY ("joinedPartnerId") REFERENCES "Partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;
