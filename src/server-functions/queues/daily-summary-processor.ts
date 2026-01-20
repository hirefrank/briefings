// @ts-nocheck - Legacy code with type mismatches, needs refactoring
// Env type is globally defined
import {
  Logger,
  SummarizationService,
  GeminiClient,
  ApiError,
  DatabaseError,
  ErrorCode,
} from '../../services/index.js';
import { getDb, setupDb, articles, feeds, dailySummaries } from '../../db.js';
import { eq, inArray, desc, and } from 'drizzle-orm';
import {
  validateQueueMessage,
  DailySummaryProcessorMessageSchema,
  QueueDispatcher,
  type DailySummaryProcessorMessage,
} from '../utils/queue-dispatcher.js';

/**
 * Daily summary processor queue consumer
 * Processes messages from the briefings-daily-summary-processor queue
 *
 * Responsibilities:
 * 1. Fetch articles by IDs
 * 2. Generate AI summary using SummarizationService
 * 3. Save summary to database
 * 4. Trigger publishing tasks
 */
export async function queue(
  batch: MessageBatch<DailySummaryProcessorMessage>,
  env: Env
): Promise<void> {
  const logger = Logger.forService('DailySummaryProcessor');

  logger.info('Processing daily summary processor batch', {
    messageCount: batch.messages.length,
    envKeys: Object.keys(env),
    hasAppConfigKV: !!env.APP_CONFIG_KV,
    appConfigKVType: env.APP_CONFIG_KV ? typeof env.APP_CONFIG_KV : 'undefined',
  });

  // Setup database
  await setupDb(env);

  // Process messages sequentially to avoid resource conflicts
  for (const message of batch.messages) {
    try {
      await processDailySummaryProcessorMessage(message, env, logger);
      message.ack();
    } catch (error) {
      logger.error('Daily summary processor message failed', error as Error, {
        messageId: message.body.requestId,
        feedName: message.body.feedName,
        error:
          error instanceof Error
            ? {
                message: error.message,
                stack: error.stack,
                name: error.name,
              }
            : String(error),
        err: error,
      });

      // Determine if message should be retried
      const shouldRetry = isRetryableError(error);
      if (!shouldRetry) {
        message.ack(); // Don't retry
      }
      // If retryable, don't ack and let the queue retry
    }
  }
}

/**
 * Process a single daily summary processor message
 */
async function processDailySummaryProcessorMessage(
  message: Message<DailySummaryProcessorMessage>,
  env: Env,
  logger: ReturnType<typeof Logger.forService>
): Promise<void> {
  const startTime = Date.now();

  try {
    // Validate message
    const validatedMessage = validateQueueMessage(message.body, DailySummaryProcessorMessageSchema);

    logger.info('Processing daily summary processor message', {
      requestId: validatedMessage.requestId,
      date: validatedMessage.date,
      feedName: validatedMessage.feedName,
      articleCount: validatedMessage.articleIds.length,
      force: validatedMessage.force,
    });

    // Get database instance
    const db = getDb(env);

    // Check if summary already exists (unless force is true)
    if (!validatedMessage.force) {
      const summaryDate = new Date(validatedMessage.date);
      const startOfDay = new Date(summaryDate);
      startOfDay.setUTCHours(0, 0, 0, 0);
      const endOfDay = new Date(summaryDate);
      endOfDay.setUTCHours(23, 59, 59, 999);

      // Get feed info to check for existing summary
      const feedInfo = await db
        .select()
        .from(feeds)
        .where(eq(feeds.name, validatedMessage.feedName))
        .limit(1);

      if (feedInfo.length > 0) {
        const existingSummaries = await db
          .select()
          .from(dailySummaries)
          .where(
            and(
              eq(dailySummaries.feedId, feedInfo[0].id),
              eq(dailySummaries.summaryDate, summaryDate)
            )
          )
          .limit(1);

        if (existingSummaries.length > 0) {
          logger.info('Daily summary already exists, skipping', {
            requestId: validatedMessage.requestId,
            date: validatedMessage.date,
            feedName: validatedMessage.feedName,
            existingSummaryId: existingSummaries[0].id,
          });
          return;
        }
      }
    }

    // Fetch articles by IDs
    const articlesWithFeeds = await db
      .select()
      .from(articles)
      .innerJoin(feeds, eq(articles.feedId, feeds.id))
      .where(inArray(articles.id, validatedMessage.articleIds))
      .orderBy(desc(articles.pubDate));

    if (articlesWithFeeds.length === 0) {
      logger.warn('No articles found for daily summary processing', {
        requestId: validatedMessage.requestId,
        articleIds: validatedMessage.articleIds,
      });
      return;
    }

    // Transform the joined data to the format expected by summarization service
    const articleData = articlesWithFeeds.map((row) => ({
      ...row.Article,
      feed: row.Feed,
    }));

    // Initialize services
    const geminiClient = new GeminiClient({
      apiKey: env.GEMINI_API_KEY,
      logger: logger.child({ component: 'GeminiClient' }),
    });

    const summarizationService = new SummarizationService({
      geminiClient,
      logger: logger.child({ component: 'SummarizationService' }),
    });

    // Generate daily summary
    const summaryDate = new Date(validatedMessage.date);
    const summaryContent = await summarizationService.generateDailySummary(
      articleData,
      validatedMessage.feedName,
      summaryDate,
      env,
      db
    );

    // Get feedId from the first article (all articles are from the same feed)
    const feedId = articlesWithFeeds[0].Feed.id;

    // Save daily summary to database
    const savedSummary = await summarizationService.saveDailySummary(
      {
        feedId,
        summaryDate,
        summaryContent,
        structuredContent: null,
        schemaVersion: '1.0',
        sentiment: null,
        topicsList: null,
        entityList: null,
        articleCount: articlesWithFeeds.length,
      },
      validatedMessage.articleIds,
      db
    );

    logger.info('Daily summary generated and saved', {
      requestId: validatedMessage.requestId,
      summaryId: savedSummary.id,
      feedName: validatedMessage.feedName,
      date: validatedMessage.date,
      articleCount: articleData.length,
      summaryLength: summaryContent.length,
    });

    // Initialize queue dispatcher for R2 publishing only
    const queueDispatcher = QueueDispatcher.create(env);

    // R2 publishing only (LexPage is for weekly summaries only)
    if (env.R2_ENABLED === 'true') {
      await queueDispatcher.sendToR2PublishQueue(savedSummary.id, 'daily');
    }

    const duration = Date.now() - startTime;

    logger.info('Daily summary processing completed', {
      requestId: validatedMessage.requestId,
      summaryId: savedSummary.id,
      feedName: validatedMessage.feedName,
      date: validatedMessage.date,
      duration,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    const messageData = message.body;

    // Check if this is a duplicate entry error
    if (error instanceof DatabaseError && error.code === ErrorCode.DUPLICATE_ENTRY) {
      logger.info('Duplicate daily summary found, skipping', {
        requestId: messageData.requestId,
        date: messageData.date,
        feedName: messageData.feedName,
        duration,
      });
      // Don't throw - this will cause the message to be acknowledged and removed from queue
      return;
    }

    logger.error('Daily summary processing failed', error as Error, {
      requestId: messageData.requestId,
      date: messageData.date,
      feedName: messageData.feedName,
      articleCount: messageData.articleIds.length,
      duration,
      error:
        error instanceof Error
          ? {
              message: error.message,
              stack: error.stack,
              name: error.name,
            }
          : String(error),
      err: error,
    });

    throw error;
  }
}

/**
 * Determine if an error should trigger a retry
 */
function isRetryableError(error: unknown): boolean {
  // Don't retry validation errors
  if (error && typeof error === 'object' && 'name' in error && error.name === 'ValidationError') {
    return false;
  }

  // Don't retry permanent API errors
  if (error instanceof ApiError) {
    if (error.statusCode >= 400 && error.statusCode < 500) {
      return false;
    }
    return true;
  }

  // Don't retry database errors for duplicate entries
  if (error instanceof DatabaseError) {
    if (error.code === ErrorCode.DUPLICATE_ENTRY) {
      return false;
    }
    if (error.context?.operation === 'constraint_violation') {
      return false;
    }
    return true;
  }

  // Retry AI service errors (rate limits, temporary issues)
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === 'SUMMARIZATION_ERROR'
  ) {
    return true;
  }

  // Retry network errors, timeouts, etc.
  const retryablePatterns = [
    /timeout/i,
    /network/i,
    /connection/i,
    /ECONNRESET/i,
    /ENOTFOUND/i,
    /ETIMEDOUT/i,
    /rate.?limit/i,
    /quota.?exceeded/i,
  ];

  const errorMessage = error instanceof Error ? error.message : String(error);
  return retryablePatterns.some((pattern) => pattern.test(errorMessage));
}

// Type definitions for Cloudflare Queue messages
interface Message<T = unknown> {
  id: string;
  timestamp: Date;
  body: T;
  ack(): void;
  retry(): void;
}

interface MessageBatch<T = unknown> {
  queue: string;
  messages: Message<T>[];
}
