-- App releases: the APKs partners can be asked to install, and the minimum
-- version allowed to run (one row, id 'singleton').
CREATE TABLE "AppRelease" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "apkKey" TEXT NOT NULL,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AppRelease_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AppRelease_version_key" ON "AppRelease"("version");
ALTER TABLE "AppRelease" ADD CONSTRAINT "AppRelease_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "AppReleaseSetting" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "minimumSupportedVersion" TEXT NOT NULL DEFAULT '0.0.0',
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AppReleaseSetting_pkey" PRIMARY KEY ("id")
);
INSERT INTO "AppReleaseSetting" ("id") VALUES ('singleton') ON CONFLICT DO NOTHING;
