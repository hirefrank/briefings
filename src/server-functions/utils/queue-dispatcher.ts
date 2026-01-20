// @ts-nocheck - Legacy code with type mismatches, needs refactoring
import type {
  DailySummaryJobMessage,
  WeeklySummaryJobMessage,
  WeeklySummaryGenerationMessage,
} from '../../types/index.js';
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

export const WeeklySummaryInitiatorMessageSchema = z.object({
  weekStartDate: z.string(), // ISO date string
  weekEndDate: z.string(), // ISO date string
  force: z.boolean().optional().default(false),
  feedGroupId: z.string().optional(),
  topicPromptName: z.string().optional(),
  titlePromptName: z.string().optional(),
  requestId: z.string().uuid(),
  timestamp: z.string(),
});

export const WeeklySummaryAggregatorMessageSchema = z.object({
  weekStartDate: z.string(),
  weekEndDate: z.string(),
  force: z.boolean().optional().default(false),
  feedGroupId: z.string().optional(),
  topicPromptName: z.string().optional(),
  titlePromptName: z.string().optional(),
  requestId: z.string().uuid(),
  timestamp: z.string(),
});

export const WeeklySummaryGenerationSchema = z.object({
  type: z.literal('weekly-summary-generation'),
  id: z.string().uuid(),
  weekStartDate: z.string(),
  weekEndDate: z.string(),
  feedGroupId: z.string().optional(),
  promptName: z.string().optional(),
  aggregatedDataR2Key: z.string(), // R2 key for aggregated data
  timestamp: z.string(),
});

export const WeeklySummaryPostprocessorMessageSchema = z.object({
  weekStartDate: z.string(),
  weekEndDate: z.string(),
  feedGroupId: z.string().optional(),
  generatedContentKey: z.string(), // R2 key for generated content
  topicPromptName: z.string().optional(),
  titlePromptName: z.string().optional(),
  requestId: z.string().uuid(),
  timestamp: z.string(),
});

export const WeeklySummaryFinalizerMessageSchema = z.object({
  weekStartDate: z.string(),
  weekEndDate: z.string(),
  feedGroupId: z.string().optional(),
  processedDataKey: z.string(), // R2 key for processed data
  requestId: z.string().uuid(),
  timestamp: z.string(),
});

export const PublishMessageSchema = z.object({
  summaryId: z.string().uuid(),
  summaryType: z.enum(['daily', 'weekly']),
  feedGroupId: z.string().optional(),
  requestId: z.string().uuid(),
  timestamp: z.string(),
});

// Type exports
export type FeedFetchMessage = z.infer<typeof FeedFetchMessageSchema>;
export type DailySummaryMessage = z.infer<typeof DailySummaryMessageSchema>;
export type DailySummaryProcessorMessage = z.infer<typeof DailySummaryProcessorMessageSchema>;
export type WeeklySummaryInitiatorMessage = z.infer<typeof WeeklySummaryInitiatorMessageSchema>;
export type WeeklySummaryAggregatorMessage = z.infer<typeof WeeklySummaryAggregatorMessageSchema>;
// export type WeeklySummaryGenerationMessage = z.infer<typeof WeeklySummaryGenerationSchema>; // Using imported type instead
export type WeeklySummaryPostprocessorMessage = z.infer<
  typeof WeeklySummaryPostprocessorMessageSchema
>;
export type WeeklySummaryFinalizerMessage = z.infer<typeof WeeklySummaryFinalizerMessageSchema>;
export type PublishMessage = z.infer<typeof PublishMessageSchema>;

// Re-export message types with different names (for compatibility)
export type { WeeklySummaryAggregationMessage } from '../../types/index.js';

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
   * Send weekly summary initiator message
   */
  async sendToWeeklySummaryInitiatorQueue(
    weekStartDate: string,
    weekEndDate: string,
    force?: boolean,
    feedGroupId?: string,
    topicPromptName?: string,
    titlePromptName?: string
  ): Promise<string> {
    const requestId = this.generateRequestId();
    const message: WeeklySummaryInitiatorMessage = {
      weekStartDate,
      weekEndDate,
      force,
      feedGroupId,
      topicPromptName,
      titlePromptName,
      requestId,
      timestamp: this.getCurrentTimestamp(),
    };

    await this.sendToQueue(
      'WEEKLY_SUMMARY_INITIATOR_QUEUE',
      message,
      WeeklySummaryInitiatorMessageSchema
    );
    return requestId;
  }

  /**
   * Send weekly summary aggregator message
   */
  async sendToWeeklySummaryAggregatorQueue(
    weekStartDate: string,
    weekEndDate: string,
    requestId: string,
    force?: boolean,
    feedGroupId?: string,
    topicPromptName?: string,
    titlePromptName?: string
  ): Promise<void> {
    const message: WeeklySummaryAggregatorMessage = {
      weekStartDate,
      weekEndDate,
      force,
      feedGroupId,
      topicPromptName,
      titlePromptName,
      requestId,
      timestamp: this.getCurrentTimestamp(),
    };

    await this.sendToQueue(
      'WEEKLY_SUMMARY_AGGREGATOR_QUEUE',
      message,
      WeeklySummaryAggregatorMessageSchema
    );
  }

  /**
   * Send weekly summary generator message
   */
  async sendToWeeklySummaryGeneratorQueue(
    weekStartDate: string,
    weekEndDate: string,
    aggregatedDataR2Key: string,
    requestId: string,
    feedGroupId?: string,
    promptName?: string
  ): Promise<void> {
    const message: WeeklySummaryGenerationMessage = {
      type: 'weekly-summary-generation',
      id: requestId,
      weekStartDate,
      weekEndDate,
      aggregatedDataR2Key,
      feedGroupId,
      promptName,
      timestamp: this.getCurrentTimestamp(),
    };

    await this.sendToQueue(
      'WEEKLY_SUMMARY_GENERATOR_QUEUE',
      message,
      WeeklySummaryGenerationSchema
    );
  }

  /**
   * Send weekly summary postprocessor message
   */
  async sendToWeeklySummaryPostprocessorQueue(
    weekStartDate: string,
    weekEndDate: string,
    generatedContentKey: string,
    requestId: string,
    feedGroupId?: string,
    topicPromptName?: string,
    titlePromptName?: string
  ): Promise<void> {
    const message: WeeklySummaryPostprocessorMessage = {
      weekStartDate,
      weekEndDate,
      generatedContentKey,
      feedGroupId,
      topicPromptName,
      titlePromptName,
      requestId,
      timestamp: this.getCurrentTimestamp(),
    };

    await this.sendToQueue(
      'WEEKLY_SUMMARY_POSTPROCESSOR_QUEUE',
      message,
      WeeklySummaryPostprocessorMessageSchema
    );
  }

  /**
   * Send weekly summary finalizer message
   */
  async sendToWeeklySummaryFinalizerQueue(
    weekStartDate: string,
    weekEndDate: string,
    processedDataKey: string,
    requestId: string,
    feedGroupId?: string
  ): Promise<void> {
    const message: WeeklySummaryFinalizerMessage = {
      weekStartDate,
      weekEndDate,
      processedDataKey,
      feedGroupId,
      requestId,
      timestamp: this.getCurrentTimestamp(),
    };

    await this.sendToQueue(
      'WEEKLY_SUMMARY_FINALIZER_QUEUE',
      message,
      WeeklySummaryFinalizerMessageSchema
    );
  }

  /**
   * Send to publisher queues
   */
  async sendToLexPagePublishQueue(
    summaryId: string,
    summaryType: 'daily' | 'weekly',
    feedGroupId?: string
  ): Promise<string> {
    const requestId = this.generateRequestId();
    const message: PublishMessage = {
      summaryId,
      summaryType,
      feedGroupId,
      requestId,
      timestamp: this.getCurrentTimestamp(),
    };

    await this.sendToQueue('LEXPAGE_PUBLISH_QUEUE', message, PublishMessageSchema);
    return requestId;
  }

  async sendToSlackPublishQueue(
    summaryId: string,
    summaryType: 'daily' | 'weekly',
    feedGroupId?: string
  ): Promise<string> {
    const requestId = this.generateRequestId();
    const message: PublishMessage = {
      summaryId,
      summaryType,
      feedGroupId,
      requestId,
      timestamp: this.getCurrentTimestamp(),
    };

    await this.sendToQueue('SLACK_PUBLISH_QUEUE', message, PublishMessageSchema);
    return requestId;
  }

  async sendToR2PublishQueue(
    summaryId: string,
    summaryType: 'daily' | 'weekly',
    feedGroupId?: string
  ): Promise<string> {
    const requestId = this.generateRequestId();
    const message: PublishMessage = {
      summaryId,
      summaryType,
      feedGroupId,
      requestId,
      timestamp: this.getCurrentTimestamp(),
    };

    await this.sendToQueue('R2_PUBLISH_QUEUE', message, PublishMessageSchema);
    return requestId;
  }

  async sendToLoopsPublishQueue(
    summaryId: string,
    summaryType: 'daily' | 'weekly',
    feedGroupId?: string
  ): Promise<string> {
    const requestId = this.generateRequestId();
    const message: PublishMessage = {
      summaryId,
      summaryType,
      feedGroupId,
      requestId,
      timestamp: this.getCurrentTimestamp(),
    };

    await this.sendToQueue('LOOPS_PUBLISH_QUEUE', message, PublishMessageSchema);
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
   * Queue a daily summary job
   */
  async queueDailySummaryJob(message: DailySummaryJobMessage): Promise<void> {
    await this.env.DAILY_SUMMARY_JOB_QUEUE.send(message);
  }

  /**
   * Queue a weekly summary job
   */
  async queueWeeklySummaryJob(message: WeeklySummaryJobMessage): Promise<void> {
    await this.env.WEEKLY_SUMMARY_JOB_QUEUE.send(message);
  }

  /**
   * Queue weekly summary generation
   */
  async queueWeeklySummaryGeneration(message: WeeklySummaryGenerationMessage): Promise<void> {
    await this.env.WEEKLY_SUMMARY_GENERATION_QUEUE.send(message);
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
