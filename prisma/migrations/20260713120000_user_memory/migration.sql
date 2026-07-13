-- Persistent per-freelancer memory (V1): org-scoped key/value facts the AI reuses
-- across proposals. `value` is plaintext, OR AES-256-GCM ciphertext when sensitive.
-- CreateTable
CREATE TABLE "UserMemory" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "isPermanent" BOOLEAN NOT NULL DEFAULT true,
    "sensitive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "metadata" JSONB,

    CONSTRAINT "UserMemory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserMemory_orgId_category_key_key" ON "UserMemory"("orgId", "category", "key");

-- AddForeignKey
ALTER TABLE "UserMemory" ADD CONSTRAINT "UserMemory_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
