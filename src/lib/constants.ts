/**
 * Constants for Briefings RSS Summarization System
 * Model configurations and default values
 */

// ============================================================================
// GEMINI MODELS
// ============================================================================

export const GEMINI_MODELS = {
  // Flash model - faster, cheaper, used for daily summaries and clustering
  FLASH: "gemini-3-flash-preview",

  // Pro model - more capable, used for final weekly digest
  PRO: "gemini-3-pro-preview",
} as const;

// ============================================================================
// DEFAULT MODELS BY USE CASE
// ============================================================================

export const DEFAULT_MODELS = {
  DAILY_SUMMARY: GEMINI_MODELS.FLASH,
  WEEKLY_SUMMARY: GEMINI_MODELS.PRO,
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
