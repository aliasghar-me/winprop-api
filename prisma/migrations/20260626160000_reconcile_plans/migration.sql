-- Reconcile plan tiers with the product spec: solo->starter, pro->professional,
-- add enterprise. (free + agency unchanged.)
ALTER TYPE "Plan" RENAME TO "Plan_old";
CREATE TYPE "Plan" AS ENUM ('free', 'starter', 'professional', 'agency', 'enterprise');
ALTER TABLE "Org" ALTER COLUMN "plan" DROP DEFAULT;
ALTER TABLE "Org" ALTER COLUMN "plan" TYPE "Plan" USING (
  CASE "plan"::text
    WHEN 'solo' THEN 'starter'
    WHEN 'pro' THEN 'professional'
    ELSE "plan"::text
  END::"Plan");
ALTER TABLE "Org" ALTER COLUMN "plan" SET DEFAULT 'free';
DROP TYPE "Plan_old";
