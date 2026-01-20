// Env type is globally defined
import type { ScheduledEvent, ExecutionContext } from '@cloudflare/workers-types';
import { Logger } from '../../lib/logger.js';
import { QueueDispatcher } from '../utils/queue-dispatcher.js';
import { getDb, setupDb, feeds } from '../../db.js';
import { eq } from 'drizzle-orm';

/**
 * Cron handler for validating all active feeds
 * Scheduled to run daily to catch feeds that may have gone bad
 *
 * Responsibilities:
 * 1. Load all active feeds
 * 2. Queue validation for each feed
 * 3. Track validation metrics
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
    // Setup database
    await setupDb(env);
    const db = getDb(env);

    // Load all active feeds
    const activeFeeds = await db.select().from(feeds).where(eq(feeds.isActive, true));

    if (activeFeeds.length === 0) {
      logger.warn('No active feeds found for validation');
      return;
    }

    logger.info('Found active feeds for validation', {
      total: activeFeeds.length,
      valid: activeFeeds.filter((f) => f.isValid).length,
      invalid: activeFeeds.filter((f) => !f.isValid).length,
    });

    // Initialize queue dispatcher
    const queueDispatcher = QueueDispatcher.create(env);

    // Track results
    const results = {
      total: activeFeeds.length,
      queued: 0,
      failed: 0,
      skipped: 0,
    };

    // Queue validation for all feeds
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

    // Wait for all validation messages to be queued
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
