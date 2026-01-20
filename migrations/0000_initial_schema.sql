-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Credential" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "credentialId" TEXT NOT NULL,
    "publicKey" BLOB NOT NULL,
    "counter" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "Credential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Feed" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "category" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastFetchedAt" DATETIME,
    "lastError" TEXT,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Article" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "feedId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "link" TEXT NOT NULL,
    "content" TEXT,
    "contentSnippet" TEXT,
    "creator" TEXT,
    "isoDate" TEXT,
    "pubDate" DATETIME,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Article_feedId_fkey" FOREIGN KEY ("feedId") REFERENCES "Feed" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DailySummary" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "summaryDate" DATETIME NOT NULL,
    "summaryContent" TEXT NOT NULL,
    "sentToLexPage" BOOLEAN NOT NULL DEFAULT false,
    "lexPageDocumentId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "WeeklySummary" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "weekStartDate" DATETIME NOT NULL,
    "weekEndDate" DATETIME NOT NULL,
    "title" TEXT NOT NULL,
    "recapContent" TEXT NOT NULL,
    "belowTheFoldContent" TEXT,
    "soWhatContent" TEXT,
    "topics" TEXT,
    "sentToLexPage" BOOLEAN NOT NULL DEFAULT false,
    "lexPageDocumentId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ArticleSummaryRelation" (
    "articleId" TEXT NOT NULL,
    "dailySummaryId" TEXT NOT NULL,

    PRIMARY KEY ("articleId", "dailySummaryId"),
    CONSTRAINT "ArticleSummaryRelation_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ArticleSummaryRelation_dailySummaryId_fkey" FOREIGN KEY ("dailySummaryId") REFERENCES "DailySummary" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DailyWeeklySummaryRelation" (
    "dailySummaryId" TEXT NOT NULL,
    "weeklySummaryId" TEXT NOT NULL,

    PRIMARY KEY ("dailySummaryId", "weeklySummaryId"),
    CONSTRAINT "DailyWeeklySummaryRelation_dailySummaryId_fkey" FOREIGN KEY ("dailySummaryId") REFERENCES "DailySummary" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DailyWeeklySummaryRelation_weeklySummaryId_fkey" FOREIGN KEY ("weeklySummaryId") REFERENCES "WeeklySummary" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Credential_userId_key" ON "Credential"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Credential_credentialId_key" ON "Credential"("credentialId");

-- CreateIndex
CREATE INDEX "Credential_credentialId_idx" ON "Credential"("credentialId");

-- CreateIndex
CREATE INDEX "Credential_userId_idx" ON "Credential"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Feed_url_key" ON "Feed"("url");

-- CreateIndex
CREATE INDEX "Feed_category_idx" ON "Feed"("category");

-- CreateIndex
CREATE INDEX "Feed_isActive_idx" ON "Feed"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Article_link_key" ON "Article"("link");

-- CreateIndex
CREATE INDEX "Article_feedId_idx" ON "Article"("feedId");

-- CreateIndex
CREATE INDEX "Article_processed_idx" ON "Article"("processed");

-- CreateIndex
CREATE INDEX "Article_pubDate_idx" ON "Article"("pubDate");

-- CreateIndex
CREATE INDEX "Article_createdAt_idx" ON "Article"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DailySummary_summaryDate_key" ON "DailySummary"("summaryDate");

-- CreateIndex
CREATE INDEX "DailySummary_summaryDate_idx" ON "DailySummary"("summaryDate");

-- CreateIndex
CREATE INDEX "DailySummary_sentToLexPage_idx" ON "DailySummary"("sentToLexPage");

-- CreateIndex
CREATE INDEX "WeeklySummary_weekStartDate_idx" ON "WeeklySummary"("weekStartDate");

-- CreateIndex
CREATE INDEX "WeeklySummary_weekEndDate_idx" ON "WeeklySummary"("weekEndDate");

-- CreateIndex
CREATE INDEX "WeeklySummary_sentToLexPage_idx" ON "WeeklySummary"("sentToLexPage");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklySummary_weekStartDate_weekEndDate_key" ON "WeeklySummary"("weekStartDate", "weekEndDate");

-- CreateIndex
CREATE INDEX "ArticleSummaryRelation_articleId_idx" ON "ArticleSummaryRelation"("articleId");

-- CreateIndex
CREATE INDEX "ArticleSummaryRelation_dailySummaryId_idx" ON "ArticleSummaryRelation"("dailySummaryId");

-- CreateIndex
CREATE INDEX "DailyWeeklySummaryRelation_dailySummaryId_idx" ON "DailyWeeklySummaryRelation"("dailySummaryId");

-- CreateIndex
CREATE INDEX "DailyWeeklySummaryRelation_weeklySummaryId_idx" ON "DailyWeeklySummaryRelation"("weeklySummaryId");
