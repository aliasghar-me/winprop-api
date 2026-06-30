-- T2.4: idempotency keys for client-retried mutations.
CREATE TABLE "IdempotencyKey" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "statusCode" INTEGER,
  "responseJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "IdempotencyKey_orgId_key_key" ON "IdempotencyKey"("orgId", "key");
CREATE INDEX "IdempotencyKey_orgId_idx" ON "IdempotencyKey"("orgId");
