-- Expand JobStatus to the 7-stage pipeline, remapping legacy 'active' -> 'draft'.
ALTER TYPE "JobStatus" RENAME TO "JobStatus_old";
CREATE TYPE "JobStatus" AS ENUM ('draft', 'proposal_generated', 'sent', 'viewed', 'negotiation', 'won', 'lost');
ALTER TABLE "Job" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Job" ALTER COLUMN "status" TYPE "JobStatus"
  USING (CASE "status"::text WHEN 'active' THEN 'draft' ELSE "status"::text END::"JobStatus");
ALTER TABLE "Job" ALTER COLUMN "status" SET DEFAULT 'draft';
DROP TYPE "JobStatus_old";

-- Rich Job fields.
ALTER TABLE "Job"
  ADD COLUMN "clientName" TEXT,
  ADD COLUMN "clientEmail" TEXT,
  ADD COLUMN "clientWebsite" TEXT,
  ADD COLUMN "projectDescription" TEXT,
  ADD COLUMN "requirements" TEXT,
  ADD COLUMN "budget" INTEGER,
  ADD COLUMN "timeline" TEXT;

-- Rich Profile fields.
ALTER TABLE "Profile"
  ADD COLUMN "logoUrl" TEXT,
  ADD COLUMN "website" TEXT,
  ADD COLUMN "contactInfo" TEXT,
  ADD COLUMN "portfolioLinks" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "caseStudies" JSONB,
  ADD COLUMN "testimonials" JSONB;
