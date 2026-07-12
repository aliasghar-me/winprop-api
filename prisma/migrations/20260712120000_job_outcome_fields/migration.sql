-- Should-I-Apply MVP: record deal outcome on a Job for the Revenue dashboard.
ALTER TABLE "Job" ADD COLUMN "wonAmountUsd" INTEGER;
ALTER TABLE "Job" ADD COLUMN "outcomeReason" TEXT;
