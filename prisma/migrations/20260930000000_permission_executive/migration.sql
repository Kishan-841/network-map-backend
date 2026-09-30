-- New role + society-permission fields on Permission.
ALTER TYPE "Role" ADD VALUE 'PERMISSION_EXECUTIVE';

ALTER TABLE "Permission"
  ADD COLUMN "societyOffer" TEXT,
  ADD COLUMN "paymentType" TEXT,
  ADD COLUMN "demoCount" INTEGER;
