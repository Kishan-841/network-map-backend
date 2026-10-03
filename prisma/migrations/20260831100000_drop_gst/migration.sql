-- GST is not collected. No rows used it, so the value and column go cleanly.
-- Postgres cannot drop a single enum value, so the type is rebuilt.
ALTER TABLE "Partner" DROP COLUMN IF EXISTS "hasGst";

DELETE FROM "PartnerDocument" WHERE "type" = 'GST';

ALTER TYPE "PartnerDocumentType" RENAME TO "PartnerDocumentType_old";
CREATE TYPE "PartnerDocumentType" AS ENUM ('AADHAAR', 'PAN');
ALTER TABLE "PartnerDocument"
  ALTER COLUMN "type" TYPE "PartnerDocumentType"
  USING ("type"::text::"PartnerDocumentType");
DROP TYPE "PartnerDocumentType_old";
