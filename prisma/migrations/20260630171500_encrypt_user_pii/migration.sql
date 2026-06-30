-- PII at rest (security #16): email/name become ciphertext, so the plaintext
-- unique on email no longer applies. Lookups move to the emailHash blind index.
DROP INDEX IF EXISTS "User_email_key";
ALTER TABLE "User" ADD COLUMN "emailHash" TEXT;
CREATE UNIQUE INDEX "User_emailHash_key" ON "User"("emailHash");
