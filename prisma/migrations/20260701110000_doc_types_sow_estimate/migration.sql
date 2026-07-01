-- Tier 3: add SOW + estimate document types.
ALTER TYPE "DocType" ADD VALUE IF NOT EXISTS 'sow';
ALTER TYPE "DocType" ADD VALUE IF NOT EXISTS 'estimate';
