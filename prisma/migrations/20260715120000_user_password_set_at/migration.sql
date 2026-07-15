-- Card-first trial: track when a user chose a real password. Trial-provisioned
-- accounts start with a random unusable password (passwordSetAt = NULL) so the
-- onboarding set-password step and the claim-trial needsOnboarding flag can gate on it.
ALTER TABLE "User" ADD COLUMN "passwordSetAt" TIMESTAMP(3);
