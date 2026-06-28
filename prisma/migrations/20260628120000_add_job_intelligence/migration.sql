-- Add nullable AI Job-Intelligence analysis column
ALTER TABLE "Job" ADD COLUMN "intelligenceJson" JSONB;
