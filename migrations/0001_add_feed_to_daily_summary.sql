-- Migration to add feedId to DailySummary table
-- This allows multiple summaries per day (one per feed)

-- Step 1: Drop the existing unique index on summaryDate
DROP INDEX IF EXISTS "DailySummary_summaryDate_key";

-- Step 2: SQLite doesn't support ALTER TABLE ADD COLUMN with constraints
-- So we need to recreate the table

-- Create new table with the correct schema
CREATE TABLE "DailySummary_new" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "feedId" TEXT NOT NULL,
    "summaryDate" DATETIME NOT NULL,
    "summaryContent" TEXT NOT NULL,
    "sentToLexPage" BOOLEAN NOT NULL DEFAULT false,
    "lexPageDocumentId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DailySummary_feedId_fkey" FOREIGN KEY ("feedId") REFERENCES "Feed" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Copy existing data (we'll set feedId to a placeholder for now)
-- Note: This will fail if you have existing data. You may need to clear the table first.
-- INSERT INTO "DailySummary_new" SELECT id, 'placeholder', summaryDate, summaryContent, sentToLexPage, lexPageDocumentId, createdAt, updatedAt FROM "DailySummary";

-- Drop old table
DROP TABLE "DailySummary";

-- Rename new table
ALTER TABLE "DailySummary_new" RENAME TO "DailySummary";

-- Create compound unique index on (feedId, summaryDate)
CREATE UNIQUE INDEX "DailySummary_feedId_summaryDate_key" ON "DailySummary"("feedId", "summaryDate");

-- Create index on feedId for query performance
CREATE INDEX "DailySummary_feedId_idx" ON "DailySummary"("feedId");

-- Create index on summaryDate for query performance
CREATE INDEX "DailySummary_summaryDate_idx" ON "DailySummary"("summaryDate");