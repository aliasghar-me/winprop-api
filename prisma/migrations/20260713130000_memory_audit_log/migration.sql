-- Complete audit trail of UserMemory changes (V1). Append-only, org-scoped. Best-effort
-- write on create/update/delete/import. `detail` never stores decrypted sensitive values.
-- CreateTable
CREATE TABLE "MemoryAuditLog" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "memoryId" TEXT,
    "action" TEXT NOT NULL,
    "category" TEXT,
    "key" TEXT,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemoryAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MemoryAuditLog_orgId_createdAt_idx" ON "MemoryAuditLog"("orgId", "createdAt");

-- AddForeignKey
ALTER TABLE "MemoryAuditLog" ADD CONSTRAINT "MemoryAuditLog_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
