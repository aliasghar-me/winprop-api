-- Anonymous free-trial usage (pre-auth). Tracks the "Should I Apply?" verdict + 1
-- proposal a non-authenticated visitor can get without signing up. NOT tenant-scoped.
-- PRIVACY: stores hashes only (never raw IP / user-agent / fingerprint).
-- CreateTable
CREATE TABLE "TrialUsage" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "fingerprintHash" TEXT NOT NULL,
    "ipHash" TEXT NOT NULL,
    "uaHash" TEXT NOT NULL,
    "country" TEXT,
    "verdictCount" INTEGER NOT NULL DEFAULT 0,
    "proposalCount" INTEGER NOT NULL DEFAULT 0,
    "tokenUsed" INTEGER NOT NULL DEFAULT 0,
    "trialUsed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrialUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrialUsage_deviceId_key" ON "TrialUsage"("deviceId");

-- CreateIndex
CREATE INDEX "TrialUsage_ipHash_idx" ON "TrialUsage"("ipHash");

-- CreateIndex
CREATE INDEX "TrialUsage_fingerprintHash_idx" ON "TrialUsage"("fingerprintHash");
