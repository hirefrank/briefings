import {
  Logger,
  FeedService,
  ApiError,
  DatabaseError,
} from '../../services/index.js';
import { getDb, setupDb } from '../../db.js';
import type { NewFeed } from '../../db/types.js';
import {
  validateQueueMessage,
  FeedFetchMessageSchema,
  type FeedFetchMessage,
} from '../utils/queue-dispatcher.js';
import { validateRssFeed } from '../../utils/rss-validator.js';

/**
 * Feed fetch queue consumer
 * Processes messages from the briefings-feed-fetch queue
 */
export async function queue(batch: MessageBatch<FeedFetchMessage>, env: Env): Promise<void> {
  const logger = Logger.forService('FeedFetchConsumer');

  logger.info('Processing feed fetch batch', {
    messageCount: batch.messages.length,
  });

  // Setup database
  await setupDb(env);

  // Process messages in parallel
  const results = await Promise.allSettled(
    batch.messages.map((message) => processFeedFetchMessage(message, env, logger))
  );

  // Log results
  const successful = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results.filter((r) => r.status === 'rejected').length;

  logger.info('Feed fetch batch processed', {
    total: batch.messages.length,
    successful,
    failed,
  });

  // Handle failures
  const failedResults = results.filter((r, index) => {
    if (r.status === 'rejected') {
      const message = batch.messages[index];
      logger.error('Feed fetch message failed', r.reason, {
        messageId: message.body.requestId,
        feedName: message.body.feedName,
        feedUrl: message.body.feedUrl,
      });

      // Determine if message should be retried
      const shouldRetry = isRetryableError(r.reason);
      if (!shouldRetry) {
        // Acknowledge the message (don't retry)
        message.ack();
      }
      // If retryable, don't ack and let the queue retry

      return true;
    }

    // Acknowledge successful messages
    batch.messages[index].ack();
    return false;
  });

  if (failedResults.length > 0) {
    logger.warn('Some feed fetch messages failed', {
      failedCount: failedResults.length,
    });
  }
}

/**
 * Process a single feed fetch message
 */
async function processFeedFetchMessage(
  message: Message<FeedFetchMessage>,
  env: Env,
  logger: ReturnType<typeof Logger.forService>
): Promise<void> {
  const startTime = Date.now();

  try {
    // Validate message
    const validatedMessage = validateQueueMessage(message.body, FeedFetchMessageSchema);

    logger.info('Processing feed fetch message', {
      requestId: validatedMessage.requestId,
      feedName: validatedMessage.feedName,
      feedUrl: validatedMessage.feedUrl,
      action: validatedMessage.action,
    });

    // If this is a validation request, validate and return
    if (validatedMessage.action === 'validate') {
      await validateFeed(validatedMessage, env, logger);
      return;
    }

    // Initialize feed service
    const feedService = new FeedService({
      logger: logger.child({ component: 'FeedService' }),
    });

    // Fetch and process the feed
    const feedItems = await feedService.fetchFeed(validatedMessage.feedUrl);

    if (feedItems.length === 0) {
      logger.info('No items found in feed', {
        feedName: validatedMessage.feedName,
        feedUrl: validatedMessage.feedUrl,
      });
      return;
    }

    // Get database instance
    const db = getDb(env);

    // Get or create feed
    const existingFeed = await db
      .selectFrom('Feed')
      .selectAll()
      .where('url', '=', validatedMessage.feedUrl)
      .limit(1)
      .executeTakeFirst();

    let feed = existingFeed;
    if (!feed) {
      const now = Date.now();
      feed = await db
        .insertInto('Feed')
        .values({
          id: crypto.randomUUID(),
          name: validatedMessage.feedName,
          url: validatedMessage.feedUrl,
          isActive: 1,
          isValid: 1,
          errorCount: 0,
          createdAt: now,
          updatedAt: now,
        } satisfies NewFeed)
        .returningAll()
        .executeTakeFirstOrThrow();
    }

    // Process the feed items
    const result = await feedService.processArticles(feed.id, feedItems, env);

    // Update feed timestamp after successful processing
    try {
      await feedService.updateFeedTimestamp(feed.id, env);
    } catch (timestampError) {
      logger.warn('Failed to update feed timestamp', {
        feedId: feed.id,
        feedName: validatedMessage.feedName,
        error: timestampError instanceof Error ? timestampError.message : String(timestampError),
      });
    }

    const duration = Date.now() - startTime;

    logger.info('Feed fetch completed successfully', {
      requestId: validatedMessage.requestId,
      feedName: validatedMessage.feedName,
      articlesProcessed: result.length,
      newArticles: result.length,
      duplicatesSkipped: feedItems.length - result.length,
      duration,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    const messageData = message.body;

    logger.error('Feed fetch failed', error as Error, {
      requestId: messageData.requestId,
      feedName: messageData.feedName,
      feedUrl: messageData.feedUrl,
      duration,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
      errorName: error instanceof Error ? error.name : undefined,
    });

    // Update feed error information (if we have a feed ID)
    try {
      const db = getDb(env);
      const existingFeed = await db
        .selectFrom('Feed')
        .selectAll()
        .where('url', '=', messageData.feedUrl)
        .limit(1)
        .executeTakeFirst();

      if (existingFeed) {
        const feedService = new FeedService({
          logger: logger.child({ component: 'FeedService' }),
        });

        const errorMessage = error instanceof Error ? error.message : String(error);
        await feedService.updateFeedError(existingFeed.id, errorMessage, env);
      }
    } catch (updateError) {
      logger.debug('Failed to update feed error information', {
        updateError: updateError instanceof Error ? updateError.message : String(updateError),
      });
    }

    throw error;
  }
}

/**
 * Validate a feed and update its validation status in the database
 */
async function validateFeed(
  message: FeedFetchMessage,
  env: Env,
  logger: ReturnType<typeof Logger.forService>
): Promise<void> {
  const startTime = Date.now();
  const db = getDb(env);

  try {
    logger.info('Validating feed', {
      feedUrl: message.feedUrl,
      feedName: message.feedName,
    });

    const validationResult = await validateRssFeed(message.feedUrl);

    const updates: Record<string, unknown> = {
      isValid: validationResult.isValid ? 1 : 0,
      validationError: validationResult.isValid ? null : validationResult.error,
      updatedAt: Date.now(),
    };

    if (validationResult.isValid && validationResult.title) {
      updates.name = validationResult.title;
    }

    await db
      .updateTable('Feed')
      .set(updates)
      .where('url', '=', message.feedUrl)
      .execute();

    const duration = Date.now() - startTime;

    logger.info('Feed validation completed', {
      feedUrl: message.feedUrl,
      isValid: validationResult.isValid,
      error: validationResult.error,
      duration,
    });
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error('Feed validation failed', {
      feedUrl: message.feedUrl,
      error: error instanceof Error ? error.message : String(error),
      duration,
    });

    try {
      await db
        .updateTable('Feed')
        .set({
          isValid: 0,
          validationError: error instanceof Error ? error.message : 'Validation failed',
          updatedAt: Date.now(),
        })
        .where('url', '=', message.feedUrl)
        .execute();
    } catch (updateError) {
      logger.error('Failed to update feed validation status', {
        feedUrl: message.feedUrl,
        error: updateError instanceof Error ? updateError.message : String(updateError),
      });
    }

    throw error;
  }
}

/**
 * Determine if an error should trigger a retry
 */
function isRetryableError(error: unknown): boolean {
  if (error && typeof error === 'object' && 'name' in error && error.name === 'ValidationError') {
    return false;
  }

  if (error instanceof ApiError) {
    if (error.statusCode >= 400 && error.statusCode < 500) {
      return false;
    }
    return true;
  }

  if (error instanceof DatabaseError) {
    if (error.context?.operation === 'constraint_violation') {
      return false;
    }
    return true;
  }

  const retryablePatterns = [
    /timeout/i,
    /network/i,
    /connection/i,
    /ECONNRESET/i,
    /ENOTFOUND/i,
    /ETIMEDOUT/i,
    /fetch failed/i,
    /AbortError/i,
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
