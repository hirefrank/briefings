// @ts-nocheck - Legacy code with type mismatches, needs refactoring
// Env type is globally defined
import {
  Logger,
  FeedService,
  ConfigManager,
  ApiError,
  DatabaseError,
} from '../../services/index.js';
import { getDb, setupDb, feeds } from '../../db.js';
import { eq } from 'drizzle-orm';
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

    // Initialize config manager
    const configManager = new ConfigManager(logger.child({ component: 'ConfigManager' }));

    // Initialize feed service
    const feedService = new FeedService({
      configManager,
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
    const [existingFeed] = await db
      .select()
      .from(feeds)
      .where(eq(feeds.url, validatedMessage.feedUrl))
      .limit(1);

    let feed = existingFeed;
    if (!feed) {
      const [newFeed] = await db
        .insert(feeds)
        .values({
          name: validatedMessage.feedName,
          url: validatedMessage.feedUrl,
          isActive: true,
        })
        .returning();
      feed = newFeed;
    }

    // Process the feed items
    const result = await feedService.processArticles(feed.id, feedItems, env);

    // Update feed timestamp after successful processing
    try {
      await feedService.updateFeedTimestamp(feed.id, env);
    } catch (timestampError) {
      // Log warning but don't fail the entire operation
      logger.warn('Failed to update feed timestamp', {
        feedId: feed.id,
        feedName: validatedMessage.feedName,
        error: timestampError instanceof Error ? timestampError.message : String(timestampError),
      });
    }

    const duration = Date.now() - startTime;

    // Send Slack notification if articles were saved - DISABLED
    // if (result.length > 0) {
    //   const slackConfig = {
    //     webhookUrl: env.SLACK_WEBHOOK_URL,
    //     botToken: env.SLACK_TOKEN,
    //     defaultChannel: env.SLACK_DEFAULT_CHANNEL || '#general',
    //     enabled: env.SLACK_ENABLED === 'true',
    //   };

    //   const slackPublisher = createSlackPublisher(slackConfig);

    //   if (slackPublisher.isEnabled) {
    //     const message = `Fetched ${result.length} new article${result.length !== 1 ? 's' : ''} from ${validatedMessage.feedName}`;
    //     await slackPublisher.publish(`ℹ️ ${message}`, {
    //       username: 'Briefings Bot',
    //       iconEmoji: ':newspaper:',
    //     });
    //   }
    // }

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
      // Try to get the feed ID for error tracking
      const db = getDb(env);
      const [existingFeed] = await db
        .select()
        .from(feeds)
        .where(eq(feeds.url, messageData.feedUrl))
        .limit(1);

      if (existingFeed) {
        const feedService = new FeedService({
          logger: logger.child({ component: 'FeedService' }),
        });

        const errorMessage = error instanceof Error ? error.message : String(error);
        await feedService.updateFeedError(existingFeed.id, errorMessage, env);
      }
    } catch (updateError) {
      // Log but don't fail - error tracking is not critical
      logger.debug('Failed to update feed error information', {
        updateError: updateError instanceof Error ? updateError.message : String(updateError),
      });
    }

    // Re-throw to trigger queue retry logic if appropriate
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

    // Validate the RSS feed
    const validationResult = await validateRssFeed(message.feedUrl);

    // Update feed in database
    const updates: Record<string, unknown> = {
      isValid: validationResult.isValid,
      validationError: validationResult.isValid ? null : validationResult.error,
      updatedAt: new Date(),
    };

    // If validation returned a title and feed is valid, update the name
    if (validationResult.isValid && validationResult.title) {
      updates.name = validationResult.title;
    }

    await db.update(feeds).set(updates).where(eq(feeds.url, message.feedUrl));

    const duration = Date.now() - startTime;

    logger.info('Feed validation completed', {
      feedUrl: message.feedUrl,
      isValid: validationResult.isValid,
      error: validationResult.error,
      duration,
    });

    // Send Slack notification if feed is invalid - DISABLED
    // if (!validationResult.isValid && env.SLACK_ENABLED === 'true') {
    //   const slackConfig = {
    //     webhookUrl: env.SLACK_WEBHOOK_URL,
    //     botToken: env.SLACK_TOKEN,
    //     defaultChannel: env.SLACK_DEFAULT_CHANNEL || '#general',
    //     enabled: true,
    //   };

    //   const slackPublisher = createSlackPublisher(slackConfig);

    //   if (slackPublisher.isEnabled) {
    //     await slackPublisher.publish(
    //       `⚠️ Feed validation failed for ${message.feedName}: ${validationResult.error}`,
    //       {
    //         username: 'Briefings Bot',
    //         iconEmoji: ':warning:',
    //       }
    //     );
    //   }
    // }
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error('Feed validation failed', {
      feedUrl: message.feedUrl,
      error: error instanceof Error ? error.message : String(error),
      duration,
    });

    // Mark feed as invalid with error
    try {
      await db
        .update(feeds)
        .set({
          isValid: false,
          validationError: error instanceof Error ? error.message : 'Validation failed',
          updatedAt: new Date(),
        })
        .where(eq(feeds.url, message.feedUrl));
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
  // Don't retry validation errors
  if (error && typeof error === 'object' && 'name' in error && error.name === 'ValidationError') {
    return false;
  }

  // Don't retry permanent API errors
  if (error instanceof ApiError) {
    // Don't retry client errors (4xx), but retry server errors (5xx)
    if (error.statusCode >= 400 && error.statusCode < 500) {
      return false;
    }
    return true;
  }

  // Don't retry database constraint violations
  if (error instanceof DatabaseError) {
    if (error.context?.operation === 'constraint_violation') {
      return false;
    }
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
