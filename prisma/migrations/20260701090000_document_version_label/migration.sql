-- T1.3: tag timeline entries with how they were produced (tone/pricing adjust).
ALTER TABLE "DocumentVersion" ADD COLUMN "label" TEXT;
