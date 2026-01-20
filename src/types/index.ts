/**
 * Core types for the Briefings RSS Feed Summarization System
 */

import type { D1Database, KVNamespace, R2Bucket, Queue } from '@cloudflare/workers-types';

// Cloudflare Worker Environment
// Note: The global Env type is defined in src/types/env.d.ts
// CloudflareEnv is kept for backward compatibility but should be replaced with Env
export interface CloudflareEnv {
  // D1 Database
  DB: D1Database;

  // KV Namespaces
  APP_CONFIG_KV: KVNamespace;
  PROMPTS_KV?: KVNamespace; // Optional separate namespace for prompts

  // R2 Buckets
  MARKDOWN_OUTPUT_R2: R2Bucket;

  // Queue Bindings
  FEED_FETCH_QUEUE: Queue;
  DAILY_SUMMARY_JOB_QUEUE: Queue;
  DAILY_SUMMARY_PROCESSING_QUEUE: Queue;
  WEEKLY_SUMMARY_JOB_QUEUE: Queue;
  WEEKLY_SUMMARY_AGGREGATION_QUEUE: Queue;
  WEEKLY_SUMMARY_GENERATION_QUEUE: Queue;
  WEEKLY_SUMMARY_POSTPROCESSING_QUEUE: Queue;
  WEEKLY_SUMMARY_ASSEMBLY_QUEUE: Queue;
  LEX_PAGE_PUBLISH_QUEUE: Queue;
  SLACK_PUBLISH_QUEUE: Queue;
  R2_PUBLISH_QUEUE: Queue;

  // Dead Letter Queues
  FEED_FETCH_DLQ?: Queue;
  SUMMARY_DLQ?: Queue;
  PUBLISH_DLQ?: Queue;

  // Secrets
  GEMINI_API_KEY: string;
  SLACK_TOKEN?: string;
  SLACK_WEBHOOK_URL?: string;
  LEX_PAGE_API_KEY?: string;

  // Environment Variables
  TZ?: string;
  LOG_LEVEL?: string;
  LEX_PAGE_ENABLED?: string;
  SLACK_ENABLED?: string;
  R2_ENABLED?: string;
  ENVIRONMENT?: 'development' | 'staging' | 'production';
}

// FeedConfig removed - feeds are now managed as database entities via Drizzle ORM

// Queue Message Types
export interface BaseQueueMessage {
  id: string;
  timestamp: string;
  retryCount?: number;
  traceId?: string;
}

export interface FeedFetchMessage extends BaseQueueMessage {
  type: 'feed-fetch';
  feedId: number;
  feedUrl: string;
  feedName: string;
}

export interface DailySummaryJobMessage extends BaseQueueMessage {
  type: 'daily-summary-job';
  date: string; // ISO date string
  forceRegenerate?: boolean;
}

export interface DailySummaryProcessingMessage extends BaseQueueMessage {
  type: 'daily-summary-processing';
  feedId: number;
  feedName: string;
  date: string;
  articleIds: string[];
}

export interface WeeklySummaryJobMessage extends BaseQueueMessage {
  type: 'weekly-summary-job';
  weekEndDate: string; // ISO date string
  filterTopics?: string[];
  forceRegenerate?: boolean;
  skipDbSave?: boolean;
  feedGroupId?: string;
}

// Weekly Summary Step Messages
export interface WeeklySummaryAggregationMessage extends BaseQueueMessage {
  type: 'weekly-summary-aggregation';
  weekStartDate: string;
  weekEndDate: string;
  filterTopics?: string[];
  forceRegenerate?: boolean;
  feedGroupId?: string;
}

export interface WeeklySummaryGenerationMessage extends BaseQueueMessage {
  type: 'weekly-summary-generation';
  weekStartDate: string;
  weekEndDate: string;
  feedGroupId?: string;
  promptName?: string;
  aggregatedDataR2Key?: string; // For large payloads
  aggregatedData?: {
    dailySummaries: Array<{
      id: string;
      date: string;
      content: string;
      feedName: string;
    }>;
  };
}

export interface WeeklySummaryPostprocessingMessage extends BaseQueueMessage {
  type: 'weekly-summary-postprocessing';
  weekStartDate: string;
  weekEndDate: string;
  feedGroupId?: string;
  rawRecapR2Key?: string;
  rawRecap?: string;
}

export interface WeeklySummaryAssemblyMessage extends BaseQueueMessage {
  type: 'weekly-summary-assembly';
  weekStartDate: string;
  weekEndDate: string;
  feedGroupId?: string;
  rawRecap: string;
  topics: string[];
  title: string;
  skipDbSave?: boolean;
}

export interface PublishMessage extends BaseQueueMessage {
  type: 'publish';
  summaryId: string;
  summaryType: 'daily' | 'weekly';
  targetService: 'lexpage' | 'slack' | 'r2' | 'loops';
  metadata?: Record<string, unknown>;
}

// API Response Types
export interface HealthCheckResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  version?: string;
  components: {
    database: 'ok' | 'error';
    kv: 'ok' | 'error';
    r2: 'ok' | 'error';
    queues: 'ok' | 'error';
  };
  details?: Record<string, unknown>;
}

export interface TaskInitiationResponse {
  success: boolean;
  jobId: string;
  message: string;
  details?: Record<string, unknown>;
}

// Re-export Gemini types from lib
export type { GeminiGenerationConfig, GeminiResponse } from '../lib/gemini.js';

// Publisher Types
export interface PublishResult {
  success: boolean;
  service: 'lexpage' | 'slack' | 'r2' | 'loops';
  documentId?: string;
  url?: string;
  error?: string;
  timestamp: string;
}

// Configuration Types
export interface AppConfig {
  timezone: string;
  logLevel: string;
  publishers: {
    lexpage?: {
      enabled: boolean;
      apiUrl?: string;
    };
    slack?: {
      enabled: boolean;
      defaultChannel?: string;
      weeklyChannel?: string;
    };
    r2?: {
      enabled: boolean;
      pathPrefix?: string;
    };
    loops?: {
      enabled: boolean;
      defaultEmail?: string;
    };
  };
}

// Utility Types
export type QueueMessage =
  | FeedFetchMessage
  | DailySummaryJobMessage
  | DailySummaryProcessingMessage
  | WeeklySummaryJobMessage
  | WeeklySummaryAggregationMessage
  | WeeklySummaryGenerationMessage
  | WeeklySummaryPostprocessingMessage
  | WeeklySummaryAssemblyMessage
  | PublishMessage;

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};
