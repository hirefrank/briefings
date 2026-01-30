import { Logger, ApiError, ErrorCode } from '../../services/index.js';
import { getDb, setupDb } from '../../db.js';
import { toTimestamp } from '../../db/helpers.js';
import {
  validateQueueMessage,
  DailySummaryMessageSchema,
  QueueDispatcher,
  type DailySummaryMessage,
} from '../utils/queue-dispatcher.js';

/**
 * Daily summary initiator queue consumer
 * Processes messages from the briefings-daily-summary-initiator queue
 */
export async function queue(batch: MessageBatch<DailySummaryMessage>, env: Env): Promise<void> {
  const logger = Logger.forService('DailySummaryInitiator');

  logger.info('Processing daily summary initiator batch', {
    messageCount: batch.messages.length,
  });

  await setupDb(env);

  for (const message of batch.messages) {
    try {
      await processDailySummaryInitiatorMessage(message, env, logger);
      message.ack();
    } catch (error) {
      logger.error('Daily summary initiator message failed', error as Error, {
        messageId: message.body.requestId,
      });

      const shouldRetry = isRetryableError(error);
      if (!shouldRetry) {
        message.ack();
      }
    }
  }
}

async function processDailySummaryInitiatorMessage(
  message: Message<DailySummaryMessage>,
  env: Env,
  logger: ReturnType<typeof Logger.forService>
): Promise<void> {
  const startTime = Date.now();

  try {
    const validatedMessage = validateQueueMessage(message.body, DailySummaryMessageSchema);

    logger.info('Processing daily summary initiator message', {
      requestId: validatedMessage.requestId,
      date: validatedMessage.date,
      feedName: validatedMessage.feedName,
      force: validatedMessage.force,
    });

    const targetDate = new Date(validatedMessage.date);
    const startOfDay = new Date(targetDate);
    startOfDay.setUTCHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setUTCHours(23, 59, 59, 999);

    const startTs = toTimestamp(startOfDay)!;
    const endTs = toTimestamp(endOfDay)!;

    const db = getDb(env);

    // Build the query with joins
    // Note: We explicitly select columns to avoid id collision between Article and Feed
    let query = db
      .selectFrom('Article')
      .innerJoin('Feed', 'Article.feedId', 'Feed.id')
      .selectAll('Article')
      .select(['Feed.name as feedName', 'Feed.url as feedUrl', 'Feed.category as feedCategory'])
      .where('Article.pubDate', '>=', startTs)
      .where('Article.pubDate', '<', endTs);

    if (validatedMessage.feedName) {
      query = query.where('Feed.name', '=', validatedMessage.feedName);
    }

    const articlesWithFeeds = await query.execute();

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
      Array<{ articleId: string; feedName: string }>
    >();

    for (const row of articlesWithFeeds) {
      const feedName = row.feedName;
      if (!articlesByFeed.has(feedName)) {
        articlesByFeed.set(feedName, []);
      }
      articlesByFeed.get(feedName)?.push({
        articleId: row.id,
        feedName: row.feedName,
      });
    }

    logger.info('Articles grouped by feed', {
      requestId: validatedMessage.requestId,
      date: validatedMessage.date,
      totalArticles: articlesWithFeeds.length,
      feedCount: articlesByFeed.size,
      feeds: Array.from(articlesByFeed.keys()),
    });

    const queueDispatcher = QueueDispatcher.create(env);

    const dispatchPromises = Array.from(articlesByFeed.entries()).map(
      async ([feedName, feedArticles]) => {
        try {
          const processorMessage = {
            requestId: validatedMessage.requestId,
            date: validatedMessage.date,
            feedName,
            articleIds: feedArticles.map((a) => a.articleId),
            force: validatedMessage.force || false,
            timestamp: new Date().toISOString(),
          };

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
          ? { message: error.message, stack: error.stack, name: error.name }
          : String(error),
      err: error,
    });

    throw error;
  }
}

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

  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === ErrorCode.DATABASE_ERROR
  ) {
    return true;
  }

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
