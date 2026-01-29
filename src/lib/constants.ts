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
  TOPIC_EXTRACTION: GEMINI_MODELS.FLASH,
  WEEKLY_SUMMARY: GEMINI_MODELS.PRO,
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
