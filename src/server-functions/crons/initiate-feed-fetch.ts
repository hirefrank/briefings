// Env type is globally defined
import type { ScheduledEvent, ExecutionContext } from '@cloudflare/workers-types';
import { Logger, FeedService } from '../../services/index.js';
import { QueueDispatcher } from '../utils/queue-dispatcher.js';

/**
 * Cron handler for initiating feed fetch tasks
 * Scheduled via wrangler.toml: 0 *\/4 * * * (every 4 hours)
 *
 * Responsibilities:
 * 1. Load active feeds from configuration
 * 2. Queue feed fetch task for each active feed
 * 3. Track execution metrics
 */
export async function scheduled(
  event: ScheduledEvent,
  env: Env,
  ctx?: ExecutionContext
): Promise<void> {
  const logger = Logger.forService('FeedFetchCron');
  const startTime = Date.now();

  logger.info('Feed fetch cron triggered', {
    scheduledTime: new Date(event.scheduledTime).toISOString(),
    cron: event.cron,
  });

  try {
    // Initialize services
    const feedService = new FeedService({
      logger: logger.child({ component: 'FeedService' }),
    });

    // Load active feeds
    const feeds = await feedService.getActiveFeeds(env);

    if (feeds.length === 0) {
      logger.warn('No active feeds found in configuration');
      return;
    }

    // Initialize queue dispatcher
    const queueDispatcher = QueueDispatcher.create(env);

    // Track results
    const results = {
      total: 0,
      queued: 0,
      failed: 0,
      skipped: 0,
    };

    // Queue feed fetch tasks
    for (const feed of feeds) {
      results.total++;

      if (!feed.isActive) {
        logger.debug('Skipping inactive feed', { feedName: feed.name });
        results.skipped++;
        continue;
      }

      try {
        const requestId = await queueDispatcher.sendToFeedFetchQueue(feed.url, feed.name);

        logger.debug('Feed fetch task queued', {
          feedName: feed.name,
          feedUrl: feed.url,
          requestId,
        });

        results.queued++;
      } catch (error) {
        logger.error('Failed to queue feed fetch task', error as Error, {
          feedName: feed.name,
          feedUrl: feed.url,
        });

        results.failed++;
      }
    }

    const duration = Date.now() - startTime;

    logger.info('Feed fetch cron completed', {
      duration,
      results,
      nextScheduledTime: getNextScheduledTime(),
    });
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error('Feed fetch cron failed', error as Error, {
      duration,
      scheduledTime: new Date(event.scheduledTime).toISOString(),
    });

    // Re-throw to signal cron failure
    throw error;
  }
}

/**
 * Calculate next scheduled time based on cron expression
 * This is a simplified version - in production you'd use a cron parser library
 */
function getNextScheduledTime(): string {
  // For 0 *\/4 * * * (every 4 hours)
  const now = new Date();
  const hours = now.getHours();
  const nextHour = Math.ceil(hours / 4) * 4;

  const nextTime = new Date(now);
  if (nextHour === hours) {
    // If we're exactly on the hour, go to next interval
    nextTime.setHours(hours + 4);
  } else {
    nextTime.setHours(nextHour);
  }
  nextTime.setMinutes(0);
  nextTime.setSeconds(0);
  nextTime.setMilliseconds(0);

  return nextTime.toISOString();
}

// Type definitions are now globally available from Cloudflare Workers types
