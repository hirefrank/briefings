// @ts-nocheck - Legacy code with type mismatches, needs refactoring
// Env type is globally defined
import { Logger, ApiError, ErrorCode } from '../../services/index.js';
import { getDb, setupDb, articles, feeds } from '../../db.js';
import { eq, and, gte, lt } from 'drizzle-orm';
import {
  validateQueueMessage,
  DailySummaryMessageSchema,
  QueueDispatcher,
  type DailySummaryMessage,
} from '../utils/queue-dispatcher.js';

/**
 * Daily summary initiator queue consumer
 * Processes messages from the briefings-daily-summary-initiator queue
 *
 * Responsibilities:
 * 1. Query articles for the specified date and feed
 * 2. Group articles by feed
 * 3. Dispatch processing tasks for each feed with articles
 */
export async function queue(batch: MessageBatch<DailySummaryMessage>, env: Env): Promise<void> {
  const logger = Logger.forService('DailySummaryInitiator');

  logger.info('Processing daily summary initiator batch', {
    messageCount: batch.messages.length,
  });

  // Setup database
  await setupDb(env);

  // Process messages sequentially to avoid database conflicts
  for (const message of batch.messages) {
    try {
      await processDailySummaryInitiatorMessage(message, env, logger);
      message.ack();
    } catch (error) {
      logger.error('Daily summary initiator message failed', error as Error, {
        messageId: message.body.requestId,
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
 * Process a single daily summary initiator message
 */
async function processDailySummaryInitiatorMessage(
  message: Message<DailySummaryMessage>,
  env: Env,
  logger: ReturnType<typeof Logger.forService>
): Promise<void> {
  const startTime = Date.now();

  try {
    // Validate message
    const validatedMessage = validateQueueMessage(message.body, DailySummaryMessageSchema);

    logger.info('Processing daily summary initiator message', {
      requestId: validatedMessage.requestId,
      date: validatedMessage.date,
      feedName: validatedMessage.feedName,
      force: validatedMessage.force,
    });

    // Config manager would be initialized here if needed for future enhancements

    // Parse date from string
    const targetDate = new Date(validatedMessage.date);
    const startOfDay = new Date(targetDate);
    startOfDay.setUTCHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setUTCHours(23, 59, 59, 999);

    // Get database instance
    const db = getDb(env);

    // Query articles for the specified date
    const whereConditions = [gte(articles.pubDate, startOfDay), lt(articles.pubDate, endOfDay)];

    // Add feed filter if specified
    if (validatedMessage.feedName) {
      whereConditions.push(eq(feeds.name, validatedMessage.feedName));
    }

    const articlesWithFeeds = await db
      .select()
      .from(articles)
      .innerJoin(feeds, eq(articles.feedId, feeds.id))
      .where(and(...whereConditions));

    if (articlesWithFeeds.length === 0) {
      logger.info('No articles found for daily summary', {
        requestId: validatedMessage.requestId,
        date: validatedMessage.date,
        feedName: validatedMessage.feedName,
      });
      return;
    }

    // Group articles by feed
    const articlesByFeed = new Map<
      string,
      Array<{ article: typeof articles.$inferSelect; feed: typeof feeds.$inferSelect }>
    >();

    for (const row of articlesWithFeeds) {
      const feedName = row.Feed.name;
      if (!articlesByFeed.has(feedName)) {
        articlesByFeed.set(feedName, []);
      }
      const feedArticles = articlesByFeed.get(feedName);
      feedArticles?.push({ article: row.Article, feed: row.Feed });
    }

    logger.info('Articles grouped by feed', {
      requestId: validatedMessage.requestId,
      date: validatedMessage.date,
      totalArticles: articlesWithFeeds.length,
      feedCount: articlesByFeed.size,
      feeds: Array.from(articlesByFeed.keys()),
    });

    // Initialize queue dispatcher for sending processing tasks
    const queueDispatcher = QueueDispatcher.create(env);

    // Dispatch processing tasks for each feed
    const dispatchPromises = Array.from(articlesByFeed.entries()).map(
      async ([feedName, feedArticles]) => {
        try {
          // Create processing message
          const processorMessage = {
            requestId: validatedMessage.requestId,
            date: validatedMessage.date,
            feedName,
            articleIds: feedArticles.map((a) => a.article.id),
            force: validatedMessage.force || false,
            timestamp: new Date().toISOString(),
          };

          // Send to processor queue
          await queueDispatcher.sendToDailySummaryProcessorQueue(processorMessage);

          logger.info('Daily summary processing task dispatched', {
            requestId: validatedMessage.requestId,
            feedName,
            articleCount: feedArticles.length,
          });
        } catch (error) {
          logger.error('Failed to dispatch daily summary processing task', error as Error, {
            requestId: validatedMessage.requestId,
            feedName,
            articleCount: feedArticles.length,
          });
          throw error;
        }
      }
    );

    // Wait for all dispatch operations to complete
    await Promise.all(dispatchPromises);

    const duration = Date.now() - startTime;

    logger.info('Daily summary initiation completed', {
      requestId: validatedMessage.requestId,
      date: validatedMessage.date,
      totalArticles: articlesWithFeeds.length,
      feedCount: articlesByFeed.size,
      duration,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    const messageData = message.body;

    logger.error('Daily summary initiation failed', error as Error, {
      requestId: messageData.requestId,
      date: messageData.date,
      feedName: messageData.feedName,
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

  // Retry database errors (temporary issues)
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === ErrorCode.DATABASE_ERROR
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
