-- AlterTable
ALTER TABLE "SuperAdmin" ADD COLUMN     "totpEnabledAt" TIMESTAMP(3),
ADD COLUMN     "totpSecret" TEXT;
