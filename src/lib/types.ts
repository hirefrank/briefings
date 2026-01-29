/**
 * Core types for Briefings RSS Summarization System
 * Standalone types - no external dependencies
 */

// Note: The global Env type is defined in src/types/env.d.ts

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
