-- Lead status + follow-up on a customer inquiry.
CREATE TYPE "InquiryStatus" AS ENUM ('NOT_CONTACTED', 'FOLLOW_UP', 'COMPLETED', 'NOT_INTERESTED');

ALTER TABLE "CustomerInquiry"
  ADD COLUMN "status" "InquiryStatus" NOT NULL DEFAULT 'NOT_CONTACTED',
  ADD COLUMN "followUpAt" TIMESTAMP(3);
