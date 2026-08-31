-- v2: the mobile number becomes the partner's identity and passwords go away
-- entirely (partner-network.md §1). Existing partners keep their accounts and
-- sign in with the number already on their record.

-- Passwords no longer exist for partners; login is a one-time code.
ALTER TABLE "Partner" DROP COLUMN IF EXISTS "passwordHash";

-- Many partners have no email at all, so it can no longer be required.
-- The existing unique index survives; Postgres permits many NULLs in one.
ALTER TABLE "Partner" ALTER COLUMN "email" DROP NOT NULL;

-- The portal speaks English, Hindi or Marathi.
ALTER TABLE "Partner" ADD COLUMN IF NOT EXISTS "preferredLanguage" TEXT NOT NULL DEFAULT 'EN';

-- One account per number, now that the number is the identity.
CREATE UNIQUE INDEX IF NOT EXISTS "Partner_mobile_key" ON "Partner"("mobile");
