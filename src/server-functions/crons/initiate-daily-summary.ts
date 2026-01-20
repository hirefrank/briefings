// Env type is globally defined
import type { ScheduledEvent, ExecutionContext } from '@cloudflare/workers-types';
import { Logger } from '../../lib/logger.js';
import { QueueDispatcher } from '../utils/queue-dispatcher.js';
import { getDb, setupDb } from '../../db.js';
import { dailySummaries } from '../../db/schema.js';
import { and, gte, lt } from 'drizzle-orm';

/**
 * Cron handler for initiating daily summary generation
 * Scheduled via wrangler.toml: 0 10 * * * (10 AM UTC = 5 AM EST)
 *
 * Responsibilities:
 * 1. Calculate target date (yesterday)
 * 2. Check if summary already exists
 * 3. Queue daily summary task if needed
 * 4. Track execution metrics
 */
export async function scheduled(
  event: ScheduledEvent,
  env: Env,
  ctx?: ExecutionContext
): Promise<void> {
  const logger = Logger.forService('DailySummaryCron');
  const startTime = Date.now();

  logger.info('Daily summary cron triggered', {
    scheduledTime: new Date(event.scheduledTime).toISOString(),
    cron: event.cron,
  });

  try {
    // Calculate target date (yesterday)
    const targetDate = getYesterday();

    logger.info('Processing daily summary for date', {
      targetDate,
    });

    // Initialize database
    await setupDb(env);

    // Check if daily summary already exists for this date
    const existingSummaries = await checkExistingSummaries(targetDate, env);

    if (existingSummaries.length > 0) {
      logger.info('Daily summaries already exist for date', {
        targetDate,
        count: existingSummaries.length,
        // Note: DailySummary doesn't have direct feed relation
      });

      // Could optionally check if all expected feeds have summaries
      // and queue missing ones
    }

    // Initialize queue dispatcher
    const queueDispatcher = QueueDispatcher.create(env);

    // Queue daily summary generation task
    // Note: sendToDailySummaryQueue will handle all active feeds
    await queueDispatcher.sendToDailySummaryQueue(
      targetDate,
      undefined, // feedName - undefined means process all feeds
      existingSummaries.length === 0 // force regeneration if no summaries exist
    );

    const duration = Date.now() - startTime;
    logger.info('Daily summary cron completed', {
      targetDate,
      duration,
      existingSummariesCount: existingSummaries.length,
      queuedNewJob: true,
    });
  } catch (error) {
    logger.error('Failed to initiate daily summary', error as Error, {
      scheduledTime: new Date(event.scheduledTime).toISOString(),
    });
    throw error;
  }
}

/**
 * Gets yesterday's date in YYYY-MM-DD format
 */
function getYesterday(): string {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return date.toISOString().split('T')[0];
}

/**
 * Checks if daily summaries already exist for the given date
 */
async function checkExistingSummaries(targetDate: string, env: Env) {
  const startOfDay = new Date(targetDate);
  startOfDay.setUTCHours(0, 0, 0, 0);

  const endOfDay = new Date(targetDate);
  endOfDay.setUTCHours(23, 59, 59, 999);

  const db = getDb(env);
  return db
    .select()
    .from(dailySummaries)
    .where(
      and(gte(dailySummaries.summaryDate, startOfDay), lt(dailySummaries.summaryDate, endOfDay))
    );
}

/**
 * Example cron expressions for daily summary generation:
 *
 * Production schedule (9 AM Eastern):
 * - Summer (EDT): 0 13 * * * (1 PM UTC = 9 AM EDT)
 * - Winter (EST): 0 14 * * * (2 PM UTC = 9 AM EST)
 *
 * Alternative schedules:
 * - 0 9 * * * - 9 AM UTC daily
 * - 0 12 * * * - Noon UTC daily
 * - 0 0 * * * - Midnight UTC daily
 * - 0 6,18 * * * - Twice daily at 6 AM and 6 PM UTC
 *
 * Testing schedules:
 * - *\/15 * * * * - Every 15 minutes
 * - 0 * * * * - Every hour
 */
