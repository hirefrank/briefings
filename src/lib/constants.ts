/**
 * Constants for Briefings RSS Summarization System
 * Model configurations and default values
 */

// ============================================================================
// GEMINI MODELS
// ============================================================================

export const GEMINI_MODELS = {
  // Flash model - faster, cheaper, used for daily summaries and clustering
  FLASH: 'gemini-2.5-flash',

  // Pro model - more capable, used for final weekly digest
  PRO: 'gemini-2.5-pro',
} as const;

// ============================================================================
// DEFAULT MODELS BY USE CASE
// ============================================================================

export const DEFAULT_MODELS = {
  DAILY_SUMMARY: GEMINI_MODELS.FLASH,
  TOPIC_CLUSTERING: GEMINI_MODELS.FLASH,
  TOPIC_EXTRACTION: GEMINI_MODELS.FLASH,
  WEEKLY_SUMMARY: GEMINI_MODELS.PRO,
  WEEKLY_DIGEST: GEMINI_MODELS.PRO,
  BEEF_TITLE: GEMINI_MODELS.FLASH,
} as const;

// ============================================================================
// GENERATION CONFIG DEFAULTS
// ============================================================================

export const DEFAULT_GENERATION_CONFIG = {
  temperature: 0.7,
  topP: 0.95,
  topK: 40,
  maxOutputTokens: 8192,
} as const;

// ============================================================================
// SCHEDULING DEFAULTS
// ============================================================================

export const SCHEDULE_DEFAULTS = {
  FEED_FETCH_INTERVAL_HOURS: 4,
  DAILY_SUMMARY_HOUR: 5, // 5 AM local time
  WEEKLY_DIGEST_DAY: 'monday' as const,
  WEEKLY_DIGEST_HOUR: 6, // 6 AM local time
  TIMEZONE: 'America/New_York',
} as const;

// ============================================================================
// CONTENT LIMITS
// ============================================================================

export const CONTENT_LIMITS = {
  MAX_DIGEST_ITEMS: 10,
  MAX_RECENT_DIGESTS_FOR_CONTEXT: 4,
  MAX_ARTICLES_PER_DAILY_SUMMARY: 50,
} as const;

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type GeminiModel = (typeof GEMINI_MODELS)[keyof typeof GEMINI_MODELS];
export type ModelUseCase = keyof typeof DEFAULT_MODELS;
