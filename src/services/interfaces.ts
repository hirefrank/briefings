/**
 * Service interfaces for the Briefings system
 */

import type { GeminiGenerationConfig, GeminiResponse } from '../types/index.js';
import type { Db } from '../db.js';
import type { Feed, Article, DailySummary, WeeklySummary } from '../db/types.js';

// Re-export row types for convenience
export type { Article, DailySummary, WeeklySummary, Feed };

// Logger Interface
export interface ILogger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, error?: Error | unknown, context?: Record<string, unknown>): void;
  child(context: Record<string, unknown>): ILogger;
}

// Feed Service Interface
export interface IFeedService {
  getActiveFeeds(env: Env): Promise<Feed[]>;
  fetchFeed(feedUrl: string): Promise<ParsedFeedItem[]>;
  processArticles(feedId: string, articles: ParsedFeedItem[], env: Env): Promise<Article[]>;
  markArticlesProcessed(articleIds: string[], env: Env): Promise<void>;
  getArticlesForDate(date: Date, feedName: string | undefined, env: Env): Promise<Article[]>;
}

export interface ParsedFeedItem {
  title: string;
  link: string;
  content?: string;
  contentSnippet?: string;
  creator?: string;
  isoDate?: string;
  pubDate?: string;
  guid?: string;
}

// Summarization Service Interface
export interface ISummarizationService {
  generateDailySummary(
    articles: Article[],
    feedName: string,
    date: Date,
    env: Env,
    db?: Db
  ): Promise<string>;

  saveDailySummary(
    summary: Omit<DailySummary, 'id' | 'createdAt' | 'updatedAt'>,
    articleIds: string[],
    db: Db
  ): Promise<DailySummary>;

  getRelatedContext(articles: Article[], db: Db): Promise<string[]>;

  generateWeeklyRecap(
    summaries: DailySummary[],
    dateRange: { start: Date; end: Date },
    env: Env
  ): Promise<string>;

  extractTopics(content: string, env: Env, promptName?: string): Promise<string[]>;

  generateTitle(content: string, topics: string[], env: Env, promptName?: string): Promise<string>;

  parseRecapSections(content: string): {
    belowTheFold?: string;
    recapContent: string;
    soWhat?: string;
  };

  saveWeeklySummary(
    summary: Omit<WeeklySummary, 'id' | 'createdAt' | 'updatedAt'>,
    dailySummaryIds: string[],
    db: Db
  ): Promise<WeeklySummary>;
}

// Gemini Client Interface
export interface IGeminiClient {
  generateContent(
    prompt: string,
    config?: Partial<GeminiGenerationConfig>
  ): Promise<GeminiResponse>;
  generateJSON<T = unknown>(prompt: string, config?: Partial<GeminiGenerationConfig>): Promise<T>;
  generateWithRetry(
    prompt: string,
    options?: {
      maxRetries?: number;
      config?: Partial<GeminiGenerationConfig>;
      onRetry?: (attempt: number, error: Error) => void;
    }
  ): Promise<GeminiResponse>;
}
