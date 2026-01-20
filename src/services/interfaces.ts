/**
 * Service interfaces for the Briefings system
 */

import type { PublishResult, GeminiGenerationConfig, GeminiResponse } from '../types/index.js';
import type { Db } from '../db.js';
import type { InferSelectModel } from 'drizzle-orm';
import type { articles, dailySummaries, weeklySummaries, feeds } from '../db/schema.js';

// Type aliases for Drizzle models
export type Article = InferSelectModel<typeof articles>;
export type DailySummary = InferSelectModel<typeof dailySummaries>;
export type WeeklySummary = InferSelectModel<typeof weeklySummaries>;
export type Feed = InferSelectModel<typeof feeds>;
// Env type is globally defined

// Re-export PublishResult for convenience
export type { PublishResult };

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

// Prompt Manager Interface
export interface IPromptManager {
  loadPrompt(env: Env, name: string): Promise<string>;
  compileTemplate(content: string): HandlebarsTemplateDelegate;
  render(name: string, context: Record<string, unknown>, env: Env): Promise<string>;
}

// Handlebars type (simplified for interface)
export interface HandlebarsTemplateDelegate {
  (context: Record<string, unknown>): string;
}

// Publisher Interface (base)
export interface IPublisher {
  publish(summary: DailySummary | WeeklySummary, type: 'daily' | 'weekly'): Promise<PublishResult>;

  isEnabled(): boolean;
}

// Specific Publisher Interfaces
export interface ISlackPublisher extends IPublisher {
  publishToChannel(
    content: string,
    channel: string,
    options?: {
      username?: string;
      iconEmoji?: string;
      blocks?: unknown[];
    }
  ): Promise<PublishResult>;
}

export interface ILexPagePublisher extends IPublisher {
  createDocument(title: string, content: string): Promise<string>;
}

export interface IR2Publisher extends IPublisher {
  uploadFile(
    path: string,
    content: string,
    metadata?: Record<string, string>
  ): Promise<PublishResult>;

  listFiles(prefix?: string): Promise<string[]>;

  deleteFile(path: string): Promise<void>;
}

// Config Manager Interface
export interface IConfigManager {
  getPrompt(env: Env, name: string): Promise<string>;
  getSecret(env: Env, key: keyof Env): string;
  getVar(env: Env, key: keyof Env, defaultValue?: string): string;
  validateEnv(env: unknown): env is Env;
}

// Service Initializer Interface
export interface IServiceInitializer {
  initializeServices(env: Env): Promise<ServiceInstances>;
}

export interface ServiceInstances {
  logger: ILogger;
  db: Db;
  configManager: IConfigManager;
  feedService: IFeedService;
  summarizationService: ISummarizationService;
  geminiClient: IGeminiClient;
  promptManager: IPromptManager;
  publishers: {
    slack?: ISlackPublisher;
    lexpage?: ILexPagePublisher;
    r2?: IR2Publisher;
  };
}
