-- The payment entry accounts actually make: how much moved, by what route,
-- and the reference the partner can check against their bank. Additive only.

CREATE TYPE "PaymentMethod" AS ENUM ('BANK_TRANSFER', 'UPI', 'CASH', 'CHEQUE', 'OTHER');

CREATE TABLE "PartnerPayment" (
    "id"           TEXT NOT NULL,
    "partnerId"    TEXT NOT NULL,
    "month"        TEXT NOT NULL,
    -- Snapshot of what the month came to when this was recorded, so a later
    -- correction cannot make the payment disagree with itself.
    "amountOwed"   INTEGER NOT NULL,
    "amountPaid"   INTEGER NOT NULL,
    "method"       "PaymentMethod" NOT NULL,
    "reference"    TEXT,
    "note"         TEXT,
    -- When the money moved, which is not when the entry was typed (createdAt).
    "paidOn"       TIMESTAMP(3) NOT NULL,
    "recordedById" TEXT,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerPayment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PartnerPayment_partnerId_month_idx" ON "PartnerPayment"("partnerId", "month");
CREATE INDEX "PartnerPayment_paidOn_idx" ON "PartnerPayment"("paidOn");

ALTER TABLE "PartnerPayment" ADD CONSTRAINT "PartnerPayment_partnerId_fkey"
    FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- SET NULL: the payment record outlives the person who entered it.
ALTER TABLE "PartnerPayment" ADD CONSTRAINT "PartnerPayment_recordedById_fkey"
    FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Link each settled earning to the payment that settled it.
ALTER TABLE "PartnerEarning" ADD COLUMN "paymentId" TEXT;
CREATE INDEX "PartnerEarning_paymentId_idx" ON "PartnerEarning"("paymentId");
ALTER TABLE "PartnerEarning" ADD CONSTRAINT "PartnerEarning_paymentId_fkey"
    FOREIGN KEY ("paymentId") REFERENCES "PartnerPayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
