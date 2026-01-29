/**
 * Kysely database types for Briefings RSS Summarization System.
 *
 * Table names match existing D1 tables exactly.
 * SQLite stores booleans as 0/1 integers and timestamps as unix-ms integers.
 */

import type { Generated, Insertable, Selectable, Updateable } from 'kysely';

// ---------------------------------------------------------------------------
// Table interfaces
// ---------------------------------------------------------------------------

export interface FeedTable {
  id: Generated<string>;
  name: string;
  url: string;
  category: string | null;
  isActive: number; // boolean: 0 | 1
  isValid: number; // boolean: 0 | 1
  validationError: string | null;
  lastFetchedAt: number | null; // unix ms
  lastError: string | null;
  errorCount: number;
  createdAt: number | null; // unix ms
  updatedAt: number | null; // unix ms
}

export interface ArticleTable {
  id: Generated<string>;
  feedId: string;
  title: string;
  link: string;
  content: string | null;
  contentSnippet: string | null;
  creator: string | null;
  isoDate: string | null;
  pubDate: number | null; // unix ms
  processed: number; // boolean: 0 | 1
  createdAt: number | null; // unix ms
  updatedAt: number | null; // unix ms
}

export interface DailySummaryTable {
  id: Generated<string>;
  feedId: string;
  summaryDate: number; // unix ms
  summaryContent: string;
  structuredContent: string | null;
  schemaVersion: string | null;
  sentiment: number | null;
  topicsList: string | null;
  entityList: string | null;
  articleCount: number | null;
  createdAt: number | null; // unix ms
  updatedAt: number | null; // unix ms
}

export interface WeeklySummaryTable {
  id: Generated<string>;
  weekStartDate: number; // unix ms
  weekEndDate: number; // unix ms
  title: string;
  recapContent: string;
  belowTheFoldContent: string | null;
  soWhatContent: string | null;
  topics: string | null;
  sentAt: number | null; // unix ms
  createdAt: number | null; // unix ms
  updatedAt: number | null; // unix ms
}

export interface ArticleSummaryRelationTable {
  articleId: string;
  dailySummaryId: string;
}

export interface DailyWeeklySummaryRelationTable {
  dailySummaryId: string;
  weeklySummaryId: string;
}

export interface PromptTemplateTable {
  id: Generated<string>;
  name: string;
  prompt: string;
  description: string | null;
  createdAt: number | null; // unix ms
  updatedAt: number | null; // unix ms
}

// ---------------------------------------------------------------------------
// Database interface (Kysely schema map)
// ---------------------------------------------------------------------------

export interface Database {
  Feed: FeedTable;
  Article: ArticleTable;
  DailySummary: DailySummaryTable;
  WeeklySummary: WeeklySummaryTable;
  ArticleSummaryRelation: ArticleSummaryRelationTable;
  DailyWeeklySummaryRelation: DailyWeeklySummaryRelationTable;
  PromptTemplate: PromptTemplateTable;
}

// ---------------------------------------------------------------------------
// Row types (what you get back from SELECT)
// ---------------------------------------------------------------------------

export type Feed = Selectable<FeedTable>;
export type Article = Selectable<ArticleTable>;
export type DailySummary = Selectable<DailySummaryTable>;
export type WeeklySummary = Selectable<WeeklySummaryTable>;
export type ArticleSummaryRelation = Selectable<ArticleSummaryRelationTable>;
export type DailyWeeklySummaryRelation = Selectable<DailyWeeklySummaryRelationTable>;
export type PromptTemplate = Selectable<PromptTemplateTable>;

// ---------------------------------------------------------------------------
// Insert types
// ---------------------------------------------------------------------------

export type NewFeed = Insertable<FeedTable>;
export type NewArticle = Insertable<ArticleTable>;
export type NewDailySummary = Insertable<DailySummaryTable>;
export type NewWeeklySummary = Insertable<WeeklySummaryTable>;

// ---------------------------------------------------------------------------
// Update types
// ---------------------------------------------------------------------------

export type FeedUpdate = Updateable<FeedTable>;
export type ArticleUpdate = Updateable<ArticleTable>;
export type DailySummaryUpdate = Updateable<DailySummaryTable>;
export type WeeklySummaryUpdate = Updateable<WeeklySummaryTable>;
