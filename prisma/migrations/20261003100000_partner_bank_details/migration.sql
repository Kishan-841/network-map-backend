-- Partner bank details: a third document (cancelled cheque) and the account
-- itself, with the number encrypted by the application (lib/field-cipher.js).
ALTER TYPE "PartnerDocumentType" ADD VALUE 'CANCELLED_CHEQUE';

CREATE TABLE "PartnerBankAccount" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "accountHolderName" TEXT NOT NULL,
    "accountNumberEnc" TEXT NOT NULL,
    "accountLast4" TEXT NOT NULL,
    "ifsc" TEXT NOT NULL,
    "bankName" TEXT,
    "branchName" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PartnerBankAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PartnerBankAccount_partnerId_key" ON "PartnerBankAccount"("partnerId");

ALTER TABLE "PartnerBankAccount" ADD CONSTRAINT "PartnerBankAccount_partnerId_fkey"
    FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartnerBankAccount" ADD CONSTRAINT "PartnerBankAccount_updatedById_fkey"
    FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
