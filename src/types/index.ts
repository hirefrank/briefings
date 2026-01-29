/**
 * Core types for the Briefings RSS Feed Summarization System
 */

// Note: The global Env type is defined in src/types/env.d.ts

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
  service: string;
  documentId?: string;
  url?: string;
  error?: string;
  timestamp: string;
}

// Utility Types
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};
