import type { ScheduledEvent, ExecutionContext } from '@cloudflare/workers-types';
import { Logger } from '../../lib/logger.js';
import { QueueDispatcher } from '../utils/queue-dispatcher.js';
import { getDb, setupDb } from '../../db.js';

/**
 * Cron handler for validating all active feeds
 */
export async function scheduled(
  event: ScheduledEvent,
  env: Env,
  ctx?: ExecutionContext
): Promise<void> {
  const logger = Logger.forService('FeedValidationCron');
  const startTime = Date.now();

  logger.info('Feed validation cron triggered', {
    scheduledTime: new Date(event.scheduledTime).toISOString(),
    cron: event.cron,
  });

  try {
    await setupDb(env);
    const db = getDb(env);

    const activeFeeds = await db
      .selectFrom('Feed')
      .selectAll()
      .where('isActive', '=', 1)
      .execute();

    if (activeFeeds.length === 0) {
      logger.warn('No active feeds found for validation');
      return;
    }

    logger.info('Found active feeds for validation', {
      total: activeFeeds.length,
      valid: activeFeeds.filter((f) => f.isValid === 1).length,
      invalid: activeFeeds.filter((f) => f.isValid !== 1).length,
    });

    const queueDispatcher = QueueDispatcher.create(env);

    const results = {
      total: activeFeeds.length,
      queued: 0,
      failed: 0,
      skipped: 0,
    };

    const validationPromises = activeFeeds.map(async (feed) => {
      try {
        await queueDispatcher.sendFeedFetchMessage({
          feedUrl: feed.url,
          feedName: feed.name,
          feedId: feed.id,
          action: 'validate',
        });
        results.queued++;
      } catch (error) {
        logger.error('Failed to queue feed validation', error as Error, {
          feedId: feed.id,
          feedName: feed.name,
          feedUrl: feed.url,
        });
        results.failed++;
      }
    });

    await Promise.all(validationPromises);

    const duration = Date.now() - startTime;

    logger.info('Feed validation cron completed', {
      duration,
      results,
      feedsPerSecond: results.total / (duration / 1000),
    });
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error('Feed validation cron failed', error as Error, {
      duration,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
    });

    throw error;
  }
}
