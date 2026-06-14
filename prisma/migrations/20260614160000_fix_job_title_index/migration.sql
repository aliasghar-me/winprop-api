-- Align the DB unique-name backstop with the app normalization:
-- collapse internal whitespace too, so "Acme Marketplace" and "  acme   marketplace "
-- are the same name at BOTH the app layer and the DB layer (one definition of duplicate).
DROP INDEX IF EXISTS "job_org_title_uniq";
CREATE UNIQUE INDEX "job_org_title_uniq"
  ON "Job" ("orgId", lower(regexp_replace(btrim("title"), '\s+', ' ', 'g')));
