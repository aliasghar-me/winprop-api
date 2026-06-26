ALTER TABLE "Document" ADD COLUMN "shareToken" TEXT;
CREATE UNIQUE INDEX "Document_shareToken_key" ON "Document"("shareToken");
