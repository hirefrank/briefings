-- Add weekly summary instances table
CREATE TABLE IF NOT EXISTS "WeeklySummaryInstance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "feedGroupId" TEXT NOT NULL REFERENCES "FeedGroup"("id") ON DELETE CASCADE,
    "scheduleConfig" TEXT NOT NULL,
    "customPrompt" TEXT,
    "isActive" INTEGER DEFAULT 1 NOT NULL,
    "lastRunAt" INTEGER,
    "nextRunAt" INTEGER,
    "createdAt" INTEGER DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" INTEGER DEFAULT CURRENT_TIMESTAMP
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS "WeeklySummaryInstance_feedGroupId_idx" ON "WeeklySummaryInstance"("feedGroupId");
CREATE INDEX IF NOT EXISTS "WeeklySummaryInstance_isActive_idx" ON "WeeklySummaryInstance"("isActive");
CREATE INDEX IF NOT EXISTS "WeeklySummaryInstance_nextRunAt_idx" ON "WeeklySummaryInstance"("nextRunAt");

-- Add columns to FeedGroup table
ALTER TABLE "FeedGroup" ADD COLUMN "instanceId" TEXT;
ALTER TABLE "FeedGroup" ADD COLUMN "contactEmails" TEXT;