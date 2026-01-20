/**
 * Simple logger for Cloudflare Workers
 * Replaces @hirefrank/logger dependency
 */

export interface ILogger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, error?: Error | unknown, context?: Record<string, unknown>): void;
  child(context: Record<string, unknown>): ILogger;
}

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export class Logger implements ILogger {
  private readonly context: Record<string, unknown>;
  private readonly minLevel: LogLevel;
  private readonly service?: string;

  constructor(options: {
    context?: Record<string, unknown>;
    level?: LogLevel;
    service?: string;
  } = {}) {
    this.context = options.context || {};
    this.minLevel = options.level || 'info';
    this.service = options.service;
  }

  static forService(service: string): Logger {
    return new Logger({ service });
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.minLevel];
  }

  private formatMessage(level: LogLevel, message: string, context?: Record<string, unknown>): string {
    const timestamp = new Date().toISOString();
    const ctx = { ...this.context, ...context };
    const service = this.service ? `[${this.service}]` : '';
    const contextStr = Object.keys(ctx).length > 0 ? ` ${JSON.stringify(ctx)}` : '';
    return `${timestamp} ${level.toUpperCase()}${service} ${message}${contextStr}`;
  }

  debug(message: string, context?: Record<string, unknown>): void {
    if (this.shouldLog('debug')) {
      console.debug(this.formatMessage('debug', message, context));
    }
  }

  info(message: string, context?: Record<string, unknown>): void {
    if (this.shouldLog('info')) {
      console.info(this.formatMessage('info', message, context));
    }
  }

  warn(message: string, context?: Record<string, unknown>): void {
    if (this.shouldLog('warn')) {
      console.warn(this.formatMessage('warn', message, context));
    }
  }

  error(message: string, error?: Error | unknown, context?: Record<string, unknown>): void {
    if (this.shouldLog('error')) {
      const errorContext = error instanceof Error
        ? { errorMessage: error.message, errorStack: error.stack, ...context }
        : { error, ...context };
      console.error(this.formatMessage('error', message, errorContext));
    }
  }

  child(context: Record<string, unknown>): ILogger {
    return new Logger({
      context: { ...this.context, ...context },
      level: this.minLevel,
      service: this.service,
    });
  }
}

// Default logger instance
export const logger = new Logger();
