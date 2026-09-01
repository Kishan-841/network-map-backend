-- Link an invite to the introduction it was raised for. Additive only.
--
-- Not unique: a link that expires is replaced rather than edited, so one
-- introduction can accumulate several invite rows over time. The live one is
-- the newest that is neither used nor revoked.

ALTER TABLE "PartnerInvite" ADD COLUMN "referralId" TEXT;

CREATE INDEX "PartnerInvite_referralId_idx" ON "PartnerInvite"("referralId");

-- SET NULL, not CASCADE: deleting an introduction must not delete the record
-- that a link was issued and possibly used.
ALTER TABLE "PartnerInvite" ADD CONSTRAINT "PartnerInvite_referralId_fkey"
    FOREIGN KEY ("referralId") REFERENCES "PartnerReferral"("id") ON DELETE SET NULL ON UPDATE CASCADE;
