/**
 * Briefings Library
 * Standalone utilities - no external @hirefrank/* dependencies
 */

// Errors
export * from './errors.js';

// Constants
export * from './constants.js';

// Logger
export { Logger, logger } from './logger.js';
export type { ILogger } from './logger.js';

// Gemini Client
export { GeminiClient } from './gemini.js';
export type { GeminiGenerationConfig, GeminiResponse } from './gemini.js';

// R2 Storage
export { R2Storage, createR2Storage } from './r2.js';
export type { StoredDigest, DigestContext } from './r2.js';

// Prompts
export * from './prompts.js';

// Email
export { ResendEmailService, createEmailService } from './email.js';
export type { EmailRecipient, SendEmailOptions, EmailResult } from './email.js';
