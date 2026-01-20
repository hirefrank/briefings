/**
 * Core types for Briefings RSS Summarization System
 * Standalone types - no external dependencies
 */

import type { D1Database, R2Bucket, Queue } from '@cloudflare/workers-types';

// ============================================================================
// CLOUDFLARE ENVIRONMENT
// ============================================================================

export interface Env {
  // D1 Database
  DB: D1Database;

  // R2 Buckets
  DIGEST_BUCKET: R2Bucket;

  // Queue Bindings
  FEED_FETCH_QUEUE: Queue;
  DAILY_SUMMARY_QUEUE: Queue;
  WEEKLY_DIGEST_QUEUE: Queue;

  // Secrets
  GEMINI_API_KEY: string;
  RESEND_API_KEY: string;
  API_KEY: string; // For authenticating manual triggers

  // Environment Variables
  TIMEZONE?: string;
  FROM_EMAIL?: string;
  DAILY_SUMMARY_HOUR?: string;
  WEEKLY_DIGEST_DAY?: string;
  WEEKLY_DIGEST_HOUR?: string;
  ENVIRONMENT?: 'development' | 'staging' | 'production';
}

// ============================================================================
// QUEUE MESSAGE TYPES
// ============================================================================

export interface BaseQueueMessage {
  id: string;
  timestamp: string;
  retryCount?: number;
}

export interface FeedFetchMessage extends BaseQueueMessage {
  type: 'feed-fetch';
  feedId: string;
  feedUrl: string;
  feedName: string;
}

export interface DailySummaryMessage extends BaseQueueMessage {
  type: 'daily-summary';
  feedId: string;
  feedName: string;
  date: string; // ISO date string
  articleIds: string[];
}

export interface WeeklyDigestMessage extends BaseQueueMessage {
  type: 'weekly-digest';
  weekStartDate: string; // ISO date string
  weekEndDate: string; // ISO date string
  forceRegenerate?: boolean;
}

export type QueueMessage =
  | FeedFetchMessage
  | DailySummaryMessage
  | WeeklyDigestMessage;

// ============================================================================
// API RESPONSE TYPES
// ============================================================================

export interface HealthCheckResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  version?: string;
  components: {
    database: 'ok' | 'error';
    r2: 'ok' | 'error';
    queues: 'ok' | 'error';
  };
}

export interface TaskInitiationResponse {
  success: boolean;
  jobId: string;
  message: string;
  details?: Record<string, unknown>;
}

// ============================================================================
// DIGEST TYPES
// ============================================================================

export interface DigestCluster {
  topic: string;
  articles: string[];
  sources: string[];
  significance: string;
  isNewThisWeek: boolean;
  priorCoverage: string | null;
}

export interface ClusteringResult {
  clusters: DigestCluster[];
}

export interface DigestItem {
  topic: string;
  headline: string;
  summary: string;
  sources: string[];
}

export interface WeeklyDigestResult {
  title: string;
  items: DigestItem[];
}

// ============================================================================
// EMAIL TYPES
// ============================================================================

export interface DigestEmail {
  from: string;
  to: string[];
  subject: string;
  html: string;
}

// ============================================================================
// CONFIG TYPES
// ============================================================================

export interface FeedConfig {
  url: string;
  name: string;
  active?: boolean;
}

export interface AppConfig {
  feeds: FeedConfig[];
  recipients: string[];
}

// ============================================================================
// UTILITY TYPES
// ============================================================================

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};
