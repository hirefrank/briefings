// @ts-nocheck - Legacy code with type mismatches, needs refactoring
// Env type is globally defined
import { Logger } from '../../services/index.js';
import { z } from 'zod';

// Queue message schemas
export const FeedFetchMessageSchema = z.object({
  feedUrl: z.string().url(),
  feedName: z.string(),
  feedId: z.string().optional(),
  action: z.enum(['fetch', 'validate']).optional().default('fetch'),
  requestId: z.string().uuid(),
  timestamp: z.string(),
});

export const DailySummaryMessageSchema = z.object({
  date: z.string(), // ISO date string
  feedName: z.string().optional(),
  force: z.boolean().optional().default(false),
  requestId: z.string().uuid(),
  timestamp: z.string(),
});

export const DailySummaryProcessorMessageSchema = z.object({
  date: z.string(), // ISO date string
  feedName: z.string(),
  articleIds: z.array(z.string().uuid()),
  force: z.boolean().optional().default(false),
  requestId: z.string().uuid(),
  timestamp: z.string(),
});

export const WeeklyDigestMessageSchema = z.object({
  weekStartDate: z.string(),
  weekEndDate: z.string(),
  force: z.boolean().optional().default(false),
  feedGroupId: z.string().optional(),
  requestId: z.string().uuid(),
  timestamp: z.string(),
});

// Type exports
export type FeedFetchMessage = z.infer<typeof FeedFetchMessageSchema>;
export type DailySummaryMessage = z.infer<typeof DailySummaryMessageSchema>;
export type DailySummaryProcessorMessage = z.infer<typeof DailySummaryProcessorMessageSchema>;
export type WeeklyDigestMessage = z.infer<typeof WeeklyDigestMessageSchema>;

/**
 * Validate queue message
 */
export function validateQueueMessage<T>(message: unknown, schema: z.ZodSchema<T>): T {
  return schema.parse(message);
}

/**
 * Queue dispatcher for sending messages to Cloudflare Queues
 */
export class QueueDispatcher {
  private readonly env: Env;
  private readonly logger: ReturnType<typeof Logger.forService>;

  constructor(env: Env) {
    this.env = env;
    this.logger = Logger.forService('QueueDispatcher');
  }

  /**
   * Generate a unique request ID
   */
  private generateRequestId(): string {
    return crypto.randomUUID();
  }

  /**
   * Get current timestamp
   */
  private getCurrentTimestamp(): string {
    return new Date().toISOString();
  }

  /**
   * Validate and send message to queue
   */
  private async sendToQueue<T>(
    queueBinding: string,
    message: T,
    schema: z.ZodSchema<T>,
    options?: {
      delaySeconds?: number;
      contentType?: string;
    }
  ): Promise<void> {
    try {
      // Validate message
      const validatedMessage = schema.parse(message);

      // Get queue from environment
      const queue = (this.env as Record<string, unknown>)[queueBinding] as Queue;
      if (!queue) {
        throw new Error(`Queue binding '${queueBinding}' not found`);
      }

      // Send to queue
      await queue.send(validatedMessage, {
        delaySeconds: options?.delaySeconds,
        contentType: options?.contentType || 'json',
      });

      this.logger.info('Message sent to queue', {
        queue: queueBinding,
        messageId: (validatedMessage as { requestId?: string }).requestId,
      });
    } catch (error) {
      this.logger.error('Failed to send message to queue', error as Error, {
        queue: queueBinding,
      });
      throw error;
    }
  }

  /**
   * Send feed fetch message
   */
  async sendToFeedFetchQueue(
    feedUrl: string,
    feedName: string,
    options?: { feedId?: string; action?: 'fetch' | 'validate' }
  ): Promise<string> {
    const requestId = this.generateRequestId();
    const message: FeedFetchMessage = {
      feedUrl,
      feedName,
      feedId: options?.feedId,
      action: options?.action || 'fetch',
      requestId,
      timestamp: this.getCurrentTimestamp(),
    };

    await this.sendToQueue('FEED_FETCH_QUEUE', message, FeedFetchMessageSchema);
    return requestId;
  }

  /**
   * Send feed validation message
   */
  async sendFeedFetchMessage(
    params: Omit<FeedFetchMessage, 'requestId' | 'timestamp'>
  ): Promise<string> {
    const requestId = this.generateRequestId();
    const message: FeedFetchMessage = {
      ...params,
      requestId,
      timestamp: this.getCurrentTimestamp(),
    };

    await this.sendToQueue('FEED_FETCH_QUEUE', message, FeedFetchMessageSchema);
    return requestId;
  }

  /**
   * Send daily summary message
   */
  async sendToDailySummaryQueue(date: string, feedName?: string, force?: boolean): Promise<string> {
    const requestId = this.generateRequestId();
    const message: DailySummaryMessage = {
      date,
      feedName,
      force,
      requestId,
      timestamp: this.getCurrentTimestamp(),
    };

    await this.sendToQueue('DAILY_SUMMARY_INITIATOR_QUEUE', message, DailySummaryMessageSchema);
    return requestId;
  }

  /**
   * Send daily summary processor message
   */
  async sendToDailySummaryProcessorQueue(
    message: Omit<DailySummaryProcessorMessage, 'timestamp'>
  ): Promise<void> {
    const processorMessage: DailySummaryProcessorMessage = {
      ...message,
      timestamp: this.getCurrentTimestamp(),
    };

    await this.sendToQueue(
      'DAILY_SUMMARY_PROCESSOR_QUEUE',
      processorMessage,
      DailySummaryProcessorMessageSchema
    );
  }

  /**
   * Send weekly digest message
   */
  async sendToWeeklyDigestQueue(
    weekStartDate: string,
    weekEndDate: string,
    force?: boolean,
    feedGroupId?: string
  ): Promise<string> {
    const requestId = this.generateRequestId();
    const message: WeeklyDigestMessage = {
      weekStartDate,
      weekEndDate,
      force,
      feedGroupId,
      requestId,
      timestamp: this.getCurrentTimestamp(),
    };

    await this.sendToQueue('WEEKLY_DIGEST_QUEUE', message, WeeklyDigestMessageSchema);
    return requestId;
  }

  /**
   * Send message with batch support
   */
  async sendBatch<T>(queueBinding: string, messages: T[], schema: z.ZodSchema<T>): Promise<void> {
    if (messages.length === 0) {
      return;
    }

    try {
      // Validate all messages
      const validatedMessages = messages.map((msg) => schema.parse(msg));

      // Get queue from environment
      const queue = (this.env as Record<string, unknown>)[queueBinding] as Queue;
      if (!queue) {
        throw new Error(`Queue binding '${queueBinding}' not found`);
      }

      // Send batch
      await queue.sendBatch(validatedMessages.map((msg) => ({ body: msg })));

      this.logger.info('Batch messages sent to queue', {
        queue: queueBinding,
        count: messages.length,
      });
    } catch (error) {
      this.logger.error('Failed to send batch messages to queue', error as Error, {
        queue: queueBinding,
        count: messages.length,
      });
      throw error;
    }
  }

  /**
   * Create QueueDispatcher instance
   */
  static create(env: Env): QueueDispatcher {
    return new QueueDispatcher(env);
  }
}

// Type definitions for Cloudflare Queue
interface Queue {
  send(body: unknown, options?: { delaySeconds?: number; contentType?: string }): Promise<void>;
  sendBatch(
    messages: Array<{ body: unknown; delaySeconds?: number; contentType?: string }>
  ): Promise<void>;
}
