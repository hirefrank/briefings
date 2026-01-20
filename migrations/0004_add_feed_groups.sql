-- Add feed groups and mapping table
CREATE TABLE IF NOT EXISTS "FeedGroup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "weeklyPrompt" TEXT,
    "lexEnabled" INTEGER DEFAULT 1,
    "r2Enabled" INTEGER DEFAULT 1,
    "loopsEnabled" INTEGER DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "FeedGroupFeed" (
    "feedGroupId" TEXT NOT NULL REFERENCES "FeedGroup"("id") ON DELETE CASCADE,
    "feedId" TEXT NOT NULL REFERENCES "Feed"("id") ON DELETE CASCADE,
    PRIMARY KEY ("feedGroupId", "feedId")
);

CREATE INDEX IF NOT EXISTS "FeedGroupFeed_feed_idx" ON "FeedGroupFeed"("feedId");
