-- CreateTable
CREATE TABLE "QuotaPeriod" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "used" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "QuotaPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QuotaPeriod_orgId_periodStart_key" ON "QuotaPeriod"("orgId", "periodStart");
