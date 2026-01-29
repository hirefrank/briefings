/**
 * Cron handler for initiating weekly digest generation
 * Scheduled via wrangler.toml: 0 13 * * 0 (1 PM UTC = 8 AM ET Sunday)
 * 
 * Workflow:
 * 1. Calculate week range (Monday to Sunday)
 * 2. Queue weekly digest generation task
 */

import type { ScheduledEvent, ExecutionContext } from '@cloudflare/workers-types';
import { Logger } from '../../lib/logger.js';
import { QueueDispatcher } from '../utils/queue-dispatcher.js';
import { getDb, setupDb } from '../../db.js';
import { subDays, format, previousMonday, isSunday } from 'date-fns';

export async function scheduled(
  event: ScheduledEvent,
  env: Env,
  _ctx: ExecutionContext
): Promise<void> {
  const logger = Logger.forService('WeeklyDigestCron');

  logger.info('Weekly digest cron triggered', {
    scheduledTime: new Date(event.scheduledTime).toISOString(),
    cron: event.cron,
  });

  try {
    await setupDb(env);

    // Calculate week range: Previous Monday to Today (Sunday)
    const today = new Date();
    const weekEnd = today; // Sunday
    const weekStart = previousMonday(weekEnd); // Monday

    logger.info('Processing weekly digest for week', {
      weekStart: format(weekStart, 'yyyy-MM-dd'),
      weekEnd: format(weekEnd, 'yyyy-MM-dd'),
    });

    // Initialize queue dispatcher
    const queueDispatcher = QueueDispatcher.create(env);

    // Queue weekly digest generation task
    const requestId = await queueDispatcher.sendToWeeklyDigestQueue(
      format(weekStart, 'yyyy-MM-dd'),
      format(weekEnd, 'yyyy-MM-dd'),
      false // Don't force regenerate
    );

    logger.info('Weekly digest task queued', {
      requestId,
      weekStart: format(weekStart, 'yyyy-MM-dd'),
      weekEnd: format(weekEnd, 'yyyy-MM-dd'),
    });

    logger.info('Weekly digest cron completed', {
      scheduledTime: new Date(event.scheduledTime).toISOString(),
      requestId,
    });
  } catch (error) {
    logger.error('Failed to initiate weekly digest', error as Error, {
      scheduledTime: new Date(event.scheduledTime).toISOString(),
    });
    throw error;
  }
}

/**
 * Calculate the week range for weekly digest
 * Week is defined as Monday to Sunday
 */
export function calculateWeekRange(endDate?: string): { start: Date; end: Date } {
  const end = endDate ? new Date(endDate) : new Date();
  
  // If no date provided, use current week (Monday to Sunday)
  if (!endDate) {
    const today = new Date();
    // If today is Sunday, use current week
    // Otherwise, use previous week
    if (isSunday(today)) {
      return {
        start: previousMonday(today),
        end: today,
      };
    } else {
      const lastSunday = subDays(today, today.getDay());
      return {
        start: previousMonday(lastSunday),
        end: lastSunday,
      };
    }
  }
  
  // If end date provided, calculate start as 6 days before
  const start = subDays(end, 6);
  return { start, end };
}
