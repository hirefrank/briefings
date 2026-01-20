/**
 * Database schema for Briefings RSS Summarization System
 * Standalone Drizzle ORM schema - no external dependencies
 */

import {
  sqliteTable,
  text,
  integer,
  real,
  unique,
  index,
  primaryKey,
} from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';

// ============================================================================
// FEEDS
// ============================================================================

export const feeds = sqliteTable(
  'Feed',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    name: text('name').notNull(),
    url: text('url').notNull().unique(),
    category: text('category'),
    isActive: integer('isActive', { mode: 'boolean' }).notNull().default(true),
    isValid: integer('isValid', { mode: 'boolean' }).notNull().default(true),
    validationError: text('validationError'),
    lastFetchedAt: integer('lastFetchedAt', { mode: 'timestamp' }),
    lastError: text('lastError'),
    errorCount: integer('errorCount').notNull().default(0),
    createdAt: integer('createdAt', { mode: 'timestamp' }).$defaultFn(
      () => new Date()
    ),
    updatedAt: integer('updatedAt', { mode: 'timestamp' })
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
  },
  (table) => {
    return {
      categoryIdx: index('Feed_category_idx').on(table.category),
      isActiveIdx: index('Feed_isActive_idx').on(table.isActive),
    };
  }
);

// ============================================================================
// ARTICLES
// ============================================================================

export const articles = sqliteTable(
  'Article',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    feedId: text('feedId')
      .notNull()
      .references(() => feeds.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    link: text('link').notNull().unique(),
    content: text('content'),
    contentSnippet: text('contentSnippet'),
    creator: text('creator'),
    isoDate: text('isoDate'),
    pubDate: integer('pubDate', { mode: 'timestamp' }),
    processed: integer('processed', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('createdAt', { mode: 'timestamp' }).$defaultFn(
      () => new Date()
    ),
    updatedAt: integer('updatedAt', { mode: 'timestamp' })
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
  },
  (table) => {
    return {
      feedIdIdx: index('Article_feedId_idx').on(table.feedId),
      processedIdx: index('Article_processed_idx').on(table.processed),
      pubDateIdx: index('Article_pubDate_idx').on(table.pubDate),
      createdAtIdx: index('Article_createdAt_idx').on(table.createdAt),
    };
  }
);

// ============================================================================
// DAILY SUMMARIES
// ============================================================================

export const dailySummaries = sqliteTable(
  'DailySummary',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    feedId: text('feedId')
      .notNull()
      .references(() => feeds.id, { onDelete: 'cascade' }),
    summaryDate: integer('summaryDate', { mode: 'timestamp' }).notNull(),
    summaryContent: text('summaryContent').notNull(),
    structuredContent: text('structuredContent'), // JSON blob for structured data
    schemaVersion: text('schemaVersion'),
    sentiment: real('sentiment'), // -1 to 1 scale
    topicsList: text('topicsList'), // Comma-separated topics
    entityList: text('entityList'), // Comma-separated entities
    articleCount: integer('articleCount'),
    createdAt: integer('createdAt', { mode: 'timestamp' }).$defaultFn(
      () => new Date()
    ),
    updatedAt: integer('updatedAt', { mode: 'timestamp' })
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
  },
  (table) => {
    return {
      feedIdSummaryDateUnique: unique('DailySummary_feedId_summaryDate_key').on(
        table.feedId,
        table.summaryDate
      ),
      feedIdIdx: index('DailySummary_feedId_idx').on(table.feedId),
      summaryDateIdx: index('DailySummary_summaryDate_idx').on(table.summaryDate),
    };
  }
);

// ============================================================================
// WEEKLY SUMMARIES
// ============================================================================

export const weeklySummaries = sqliteTable(
  'WeeklySummary',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    weekStartDate: integer('weekStartDate', { mode: 'timestamp' }).notNull(),
    weekEndDate: integer('weekEndDate', { mode: 'timestamp' }).notNull(),
    title: text('title').notNull(),
    recapContent: text('recapContent').notNull(),
    belowTheFoldContent: text('belowTheFoldContent'),
    soWhatContent: text('soWhatContent'),
    topics: text('topics'), // Comma-separated topics
    sentAt: integer('sentAt', { mode: 'timestamp' }), // When email was sent via Resend
    createdAt: integer('createdAt', { mode: 'timestamp' }).$defaultFn(
      () => new Date()
    ),
    updatedAt: integer('updatedAt', { mode: 'timestamp' })
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
  },
  (table) => {
    return {
      weekStartEndUnique: unique('WeeklySummary_weekStartDate_weekEndDate_key').on(
        table.weekStartDate,
        table.weekEndDate
      ),
      weekStartDateIdx: index('WeeklySummary_weekStartDate_idx').on(
        table.weekStartDate
      ),
      weekEndDateIdx: index('WeeklySummary_weekEndDate_idx').on(table.weekEndDate),
      sentAtIdx: index('WeeklySummary_sentAt_idx').on(table.sentAt),
    };
  }
);

// ============================================================================
// RELATION TABLES
// ============================================================================

export const articleSummaryRelations = sqliteTable(
  'ArticleSummaryRelation',
  {
    articleId: text('articleId')
      .notNull()
      .references(() => articles.id, { onDelete: 'cascade' }),
    dailySummaryId: text('dailySummaryId')
      .notNull()
      .references(() => dailySummaries.id, { onDelete: 'cascade' }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.articleId, table.dailySummaryId] }),
    articleIdIdx: index('ArticleSummaryRelation_articleId_idx').on(table.articleId),
    dailySummaryIdIdx: index('ArticleSummaryRelation_dailySummaryId_idx').on(
      table.dailySummaryId
    ),
  })
);

export const dailyWeeklySummaryRelations = sqliteTable(
  'DailyWeeklySummaryRelation',
  {
    dailySummaryId: text('dailySummaryId')
      .notNull()
      .references(() => dailySummaries.id, { onDelete: 'cascade' }),
    weeklySummaryId: text('weeklySummaryId')
      .notNull()
      .references(() => weeklySummaries.id, { onDelete: 'cascade' }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.dailySummaryId, table.weeklySummaryId] }),
    dailySummaryIdIdx: index('DailyWeeklySummaryRelation_dailySummaryId_idx').on(
      table.dailySummaryId
    ),
    weeklySummaryIdIdx: index('DailyWeeklySummaryRelation_weeklySummaryId_idx').on(
      table.weeklySummaryId
    ),
  })
);

// ============================================================================
// DRIZZLE RELATIONS
// ============================================================================

export const feedsRelations = relations(feeds, ({ many }) => ({
  articles: many(articles),
}));

export const articlesRelations = relations(articles, ({ one, many }) => ({
  feed: one(feeds, {
    fields: [articles.feedId],
    references: [feeds.id],
  }),
  summaries: many(articleSummaryRelations),
}));

export const dailySummariesRelations = relations(dailySummaries, ({ one, many }) => ({
  feed: one(feeds, {
    fields: [dailySummaries.feedId],
    references: [feeds.id],
  }),
  articles: many(articleSummaryRelations),
  weeklySummaries: many(dailyWeeklySummaryRelations),
}));

export const weeklySummariesRelations = relations(weeklySummaries, ({ many }) => ({
  dailySummaries: many(dailyWeeklySummaryRelations),
}));

export const articleSummaryRelationsRelations = relations(
  articleSummaryRelations,
  ({ one }) => ({
    article: one(articles, {
      fields: [articleSummaryRelations.articleId],
      references: [articles.id],
    }),
    dailySummary: one(dailySummaries, {
      fields: [articleSummaryRelations.dailySummaryId],
      references: [dailySummaries.id],
    }),
  })
);

export const dailyWeeklySummaryRelationsRelations = relations(
  dailyWeeklySummaryRelations,
  ({ one }) => ({
    dailySummary: one(dailySummaries, {
      fields: [dailyWeeklySummaryRelations.dailySummaryId],
      references: [dailySummaries.id],
    }),
    weeklySummary: one(weeklySummaries, {
      fields: [dailyWeeklySummaryRelations.weeklySummaryId],
      references: [weeklySummaries.id],
    }),
  })
);

// ============================================================================
// PROMPT TEMPLATES
// ============================================================================

export const promptTemplates = sqliteTable(
  'PromptTemplate',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    name: text('name').notNull().unique(),
    prompt: text('prompt').notNull(),
    description: text('description'),
    createdAt: integer('createdAt', { mode: 'timestamp' }).$defaultFn(
      () => new Date()
    ),
    updatedAt: integer('updatedAt', { mode: 'timestamp' })
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
  },
  (table) => {
    return {
      nameIdx: index('PromptTemplate_name_idx').on(table.name),
    };
  }
);

// ============================================================================
// SCHEMA EXPORT
// ============================================================================

export const schema = {
  feeds,
  articles,
  dailySummaries,
  weeklySummaries,
  articleSummaryRelations,
  dailyWeeklySummaryRelations,
  promptTemplates,
};
