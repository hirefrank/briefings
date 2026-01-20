-- Add feedGroupId to WeeklySummary table
ALTER TABLE "WeeklySummary" ADD COLUMN "feedGroupId" TEXT;

-- Drop the unique constraint on weekStartDate and weekEndDate
DROP INDEX IF EXISTS "WeeklySummary_weekStartDate_weekEndDate_key";

-- Create a new unique constraint that includes feedGroupId
CREATE UNIQUE INDEX "WeeklySummary_weekStartDate_weekEndDate_feedGroupId_key" 
ON "WeeklySummary"("weekStartDate", "weekEndDate", "feedGroupId");

-- Add an index on feedGroupId for query performance
CREATE INDEX "WeeklySummary_feedGroupId_idx" ON "WeeklySummary"("feedGroupId");