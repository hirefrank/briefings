/**
 * Error types for Briefings RSS Summarization System
 * Standalone error classes - no external dependencies
 */

// ============================================================================
// ERROR CODES
// ============================================================================

export enum ErrorCode {
  // General errors
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  CONFIGURATION_ERROR = 'CONFIGURATION_ERROR',

  // API errors
  API_ERROR = 'API_ERROR',
  API_RATE_LIMIT = 'API_RATE_LIMIT',
  API_TIMEOUT = 'API_TIMEOUT',
  API_AUTHENTICATION = 'API_AUTHENTICATION',
  API_NOT_FOUND = 'API_NOT_FOUND',

  // Queue errors
  QUEUE_ERROR = 'QUEUE_ERROR',
  QUEUE_MESSAGE_INVALID = 'QUEUE_MESSAGE_INVALID',
  QUEUE_SEND_FAILED = 'QUEUE_SEND_FAILED',

  // Database errors
  DATABASE_ERROR = 'DATABASE_ERROR',
  DATABASE_CONNECTION = 'DATABASE_CONNECTION',
  DATABASE_CONSTRAINT = 'DATABASE_CONSTRAINT',
  DUPLICATE_ENTRY = 'DUPLICATE_ENTRY',

  // Service errors
  FEED_FETCH_ERROR = 'FEED_FETCH_ERROR',
  FEED_PARSE_ERROR = 'FEED_PARSE_ERROR',
  SUMMARIZATION_ERROR = 'SUMMARIZATION_ERROR',
  PUBLISH_ERROR = 'PUBLISH_ERROR',

  // Storage errors
  R2_ERROR = 'R2_ERROR',
  STORAGE_ERROR = 'STORAGE_ERROR',
}

// ============================================================================
// ERROR CONTEXT
// ============================================================================

export interface ErrorContext {
  code: ErrorCode;
  statusCode?: number;
  service?: string;
  operation?: string;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// BASE ERROR
// ============================================================================

export abstract class BaseError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly context: ErrorContext;
  public readonly timestamp: Date;
  public readonly isOperational: boolean;

  constructor(
    message: string,
    code: ErrorCode,
    statusCode = 500,
    isOperational = true,
    context?: Partial<ErrorContext>
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.timestamp = new Date();
    this.context = {
      code,
      statusCode,
      ...context,
    };

    if ('captureStackTrace' in Error && typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      statusCode: this.statusCode,
      timestamp: this.timestamp.toISOString(),
      context: this.context,
      stack: this.stack,
    };
  }
}

// ============================================================================
// SPECIFIC ERROR CLASSES
// ============================================================================

export class ValidationError extends BaseError {
  constructor(message: string, context?: Partial<ErrorContext>) {
    super(message, ErrorCode.VALIDATION_ERROR, 400, true, context);
  }
}

export class ConfigurationError extends BaseError {
  constructor(message: string, context?: Partial<ErrorContext>) {
    super(message, ErrorCode.CONFIGURATION_ERROR, 500, false, context);
  }
}

export class ApiError extends BaseError {
  constructor(
    message: string,
    code: ErrorCode = ErrorCode.API_ERROR,
    statusCode = 500,
    context?: Partial<ErrorContext>
  ) {
    super(message, code, statusCode, true, context);
  }
}

export class RateLimitError extends ApiError {
  public readonly retryAfter: number | undefined;

  constructor(message: string, retryAfter?: number, context?: Partial<ErrorContext>) {
    super(message, ErrorCode.API_RATE_LIMIT, 429, context);
    this.retryAfter = retryAfter;
  }
}

export class TimeoutError extends ApiError {
  constructor(message: string, context?: Partial<ErrorContext>) {
    super(message, ErrorCode.API_TIMEOUT, 408, context);
  }
}

export class QueueError extends BaseError {
  constructor(
    message: string,
    code: ErrorCode = ErrorCode.QUEUE_ERROR,
    context?: Partial<ErrorContext>
  ) {
    super(message, code, 500, true, context);
  }
}

export class DatabaseError extends BaseError {
  constructor(
    message: string,
    code: ErrorCode = ErrorCode.DATABASE_ERROR,
    context?: Partial<ErrorContext>
  ) {
    super(message, code, 500, true, context);
  }
}

export class FeedError extends BaseError {
  constructor(
    message: string,
    code: ErrorCode = ErrorCode.FEED_FETCH_ERROR,
    context?: Partial<ErrorContext>
  ) {
    super(message, code, 500, true, context);
  }
}

export class SummarizationError extends BaseError {
  constructor(message: string, context?: Partial<ErrorContext>) {
    super(message, ErrorCode.SUMMARIZATION_ERROR, 500, true, context);
  }
}

export class PublishError extends BaseError {
  constructor(message: string, context?: Partial<ErrorContext>) {
    super(message, ErrorCode.PUBLISH_ERROR, 500, true, context);
  }
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

export function isBaseError(error: unknown): error is BaseError {
  return error instanceof BaseError;
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function isRateLimitError(error: unknown): error is RateLimitError {
  return error instanceof RateLimitError;
}

// ============================================================================
// ERROR CLASSIFICATION
// ============================================================================

export enum ErrorClassification {
  TRANSIENT = 'TRANSIENT',
  PERMANENT = 'PERMANENT',
  RATE_LIMIT = 'RATE_LIMIT',
}

export function classifyError(error: unknown): ErrorClassification {
  if (isRateLimitError(error)) {
    return ErrorClassification.RATE_LIMIT;
  }

  if (isBaseError(error)) {
    const permanentCodes = [
      ErrorCode.VALIDATION_ERROR,
      ErrorCode.CONFIGURATION_ERROR,
      ErrorCode.API_AUTHENTICATION,
      ErrorCode.API_NOT_FOUND,
      ErrorCode.QUEUE_MESSAGE_INVALID,
      ErrorCode.DATABASE_CONSTRAINT,
      ErrorCode.DUPLICATE_ENTRY,
    ];

    if (permanentCodes.includes(error.code)) {
      return ErrorClassification.PERMANENT;
    }

    if (error.statusCode >= 500 && error.statusCode < 600) {
      return ErrorClassification.TRANSIENT;
    }
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    const transientPatterns = [
      'timeout',
      'econnrefused',
      'enotfound',
      'econnreset',
      'network',
      'fetch failed',
    ];

    if (transientPatterns.some((pattern) => message.includes(pattern))) {
      return ErrorClassification.TRANSIENT;
    }
  }

  return ErrorClassification.PERMANENT;
}

// ============================================================================
// ERROR SERIALIZATION
// ============================================================================

export function serializeError(error: unknown): Record<string, unknown> {
  if (isBaseError(error)) {
    return error.toJSON();
  }

  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    error: String(error),
    type: typeof error,
  };
}
