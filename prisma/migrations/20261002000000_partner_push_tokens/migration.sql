-- Phones that can receive a partner's push notifications.
CREATE TABLE "PartnerPushToken" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PartnerPushToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PartnerPushToken_token_key" ON "PartnerPushToken"("token");
CREATE INDEX "PartnerPushToken_partnerId_idx" ON "PartnerPushToken"("partnerId");
ALTER TABLE "PartnerPushToken" ADD CONSTRAINT "PartnerPushToken_partnerId_fkey"
    FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
