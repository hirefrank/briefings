-- Migration: Initial schema for Briefings
-- Creates all core tables for RSS feed aggregation and AI summarization

-- Feed table: RSS feed sources
CREATE TABLE IF NOT EXISTS "Feed" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "category" TEXT,
    "isActive" INTEGER NOT NULL DEFAULT 1,
    "isValid" INTEGER NOT NULL DEFAULT 1,
    "validationError" TEXT,
    "lastFetchedAt" INTEGER,
    "lastError" TEXT,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000),
    "updatedAt" INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000)
);

-- Article table: Fetched articles from RSS feeds
CREATE TABLE IF NOT EXISTS "Article" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "feedId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "link" TEXT NOT NULL,
    "content" TEXT,
    "contentSnippet" TEXT,
    "creator" TEXT,
    "isoDate" TEXT,
    "pubDate" INTEGER,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000),
    "updatedAt" INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000),
    FOREIGN KEY ("feedId") REFERENCES "Feed"("id") ON DELETE CASCADE
);

-- Create index on feedId for faster lookups
CREATE INDEX IF NOT EXISTS "idx_article_feedId" ON "Article"("feedId");
CREATE INDEX IF NOT EXISTS "idx_article_pubDate" ON "Article"("pubDate");
CREATE INDEX IF NOT EXISTS "idx_article_processed" ON "Article"("processed");

-- DailySummary table: AI-generated daily summaries
CREATE TABLE IF NOT EXISTS "DailySummary" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "feedId" TEXT NOT NULL,
    "summaryDate" INTEGER NOT NULL,
    "summaryContent" TEXT NOT NULL,
    "structuredContent" TEXT,
    "schemaVersion" TEXT,
    "sentiment" REAL,
    "topicsList" TEXT,
    "entityList" TEXT,
    "articleCount" INTEGER,
    "createdAt" INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000),
    "updatedAt" INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000),
    FOREIGN KEY ("feedId") REFERENCES "Feed"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_dailySummary_feedId" ON "DailySummary"("feedId");
CREATE INDEX IF NOT EXISTS "idx_dailySummary_summaryDate" ON "DailySummary"("summaryDate");

-- WeeklySummary table: AI-generated weekly digest newsletters
CREATE TABLE IF NOT EXISTS "WeeklySummary" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "weekStartDate" INTEGER NOT NULL,
    "weekEndDate" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "recapContent" TEXT NOT NULL,
    "belowTheFoldContent" TEXT,
    "soWhatContent" TEXT,
    "topics" TEXT,
    "sentAt" INTEGER,
    "createdAt" INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000),
    "updatedAt" INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000)
);

CREATE INDEX IF NOT EXISTS "idx_weeklySummary_weekStartDate" ON "WeeklySummary"("weekStartDate");
CREATE INDEX IF NOT EXISTS "idx_weeklySummary_sentAt" ON "WeeklySummary"("sentAt");

-- ArticleSummaryRelation table: Many-to-many relationship between articles and daily summaries
CREATE TABLE IF NOT EXISTS "ArticleSummaryRelation" (
    "articleId" TEXT NOT NULL,
    "dailySummaryId" TEXT NOT NULL,
    PRIMARY KEY ("articleId", "dailySummaryId"),
    FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE,
    FOREIGN KEY ("dailySummaryId") REFERENCES "DailySummary"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_articleSummary_dailySummaryId" ON "ArticleSummaryRelation"("dailySummaryId");

-- DailyWeeklySummaryRelation table: Many-to-many relationship between daily and weekly summaries
CREATE TABLE IF NOT EXISTS "DailyWeeklySummaryRelation" (
    "dailySummaryId" TEXT NOT NULL,
    "weeklySummaryId" TEXT NOT NULL,
    PRIMARY KEY ("dailySummaryId", "weeklySummaryId"),
    FOREIGN KEY ("dailySummaryId") REFERENCES "DailySummary"("id") ON DELETE CASCADE,
    FOREIGN KEY ("weeklySummaryId") REFERENCES "WeeklySummary"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_dailyWeeklySummary_weeklySummaryId" ON "DailyWeeklySummaryRelation"("weeklySummaryId");

-- PromptTemplate table: Customizable AI prompt storage
CREATE TABLE IF NOT EXISTS "PromptTemplate" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "name" TEXT NOT NULL UNIQUE,
    "prompt" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000),
    "updatedAt" INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000)
);

CREATE INDEX IF NOT EXISTS "idx_promptTemplate_name" ON "PromptTemplate"("name");
