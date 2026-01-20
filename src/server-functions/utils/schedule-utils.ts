import type { Logger } from '../../services/index.js';

/**
 * Utilities for working with cron schedules
 */

// Cron expression parts
interface CronParts {
  minute: string;
  hour: string;
  dayOfMonth: string;
  month: string;
  dayOfWeek: string;
}

/**
 * Parse a cron expression into its component parts
 * @param expression - Cron expression like 0 9 * * *
 * @returns Parsed cron parts
 */
export function parseCronExpression(expression: string): CronParts {
  const parts = expression.trim().split(/\s+/);

  if (parts.length !== 5) {
    throw new Error(
      `Invalid cron expression: "${expression}". Expected 5 parts, got ${parts.length}`
    );
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  return {
    minute,
    hour,
    dayOfMonth,
    month,
    dayOfWeek,
  };
}

/**
 * Validate a cron expression
 * @param expression - Cron expression to validate
 * @returns True if valid, throws error if invalid
 */
export function validateCronExpression(expression: string): boolean {
  const parts = parseCronExpression(expression);

  // Validate minute (0-59)
  if (!isValidCronField(parts.minute, 0, 59)) {
    throw new Error(`Invalid minute field: ${parts.minute}`);
  }

  // Validate hour (0-23)
  if (!isValidCronField(parts.hour, 0, 23)) {
    throw new Error(`Invalid hour field: ${parts.hour}`);
  }

  // Validate day of month (1-31)
  if (!isValidCronField(parts.dayOfMonth, 1, 31)) {
    throw new Error(`Invalid day of month field: ${parts.dayOfMonth}`);
  }

  // Validate month (1-12)
  if (!isValidCronField(parts.month, 1, 12)) {
    throw new Error(`Invalid month field: ${parts.month}`);
  }

  // Validate day of week (0-7, where 0 and 7 are Sunday)
  if (!isValidCronField(parts.dayOfWeek, 0, 7)) {
    throw new Error(`Invalid day of week field: ${parts.dayOfWeek}`);
  }

  return true;
}

/**
 * Validate a single cron field
 */
function isValidCronField(field: string, min: number, max: number): boolean {
  // Wildcard is always valid
  if (field === '*') return true;

  // Step values (e.g., *\/4)
  if (field.includes('/')) {
    const [range, step] = field.split('/');
    const stepNum = parseInt(step, 10);

    if (isNaN(stepNum) || stepNum < 1) return false;

    if (range === '*') return true;

    // Range with step (e.g., 0-23/2)
    if (range.includes('-')) {
      return isValidCronRange(range, min, max);
    }

    return false;
  }

  // Ranges (e.g., 1-5)
  if (field.includes('-')) {
    return isValidCronRange(field, min, max);
  }

  // Lists (e.g., 1,3,5)
  if (field.includes(',')) {
    const values = field.split(',');
    return values.every((v) => isValidCronValue(v, min, max));
  }

  // Single value
  return isValidCronValue(field, min, max);
}

/**
 * Validate a cron range (e.g., 1-5)
 */
function isValidCronRange(range: string, min: number, max: number): boolean {
  const [start, end] = range.split('-').map((v) => parseInt(v, 10));

  if (isNaN(start) || isNaN(end)) return false;

  return start >= min && start <= max && end >= min && end <= max && start <= end;
}

/**
 * Validate a single cron value
 */
function isValidCronValue(value: string, min: number, max: number): boolean {
  const num = parseInt(value, 10);

  if (isNaN(num)) return false;

  return num >= min && num <= max;
}

/**
 * Calculate the next run time for a cron expression
 * This is a simplified implementation - for production use a library like cron-parser
 * @param cronExpression - Cron expression
 * @param fromDate - Date to calculate from (defaults to now)
 * @returns Next scheduled time
 */
export function getNextScheduledTime(cronExpression: string, fromDate: Date = new Date()): Date {
  // Parts are parsed but not used in the simplified implementation
  parseCronExpression(cronExpression);
  const next = new Date(fromDate.getTime());

  // Common patterns
  if (cronExpression === '0 */4 * * *') {
    // Every 4 hours
    const currentHour = next.getHours();
    const nextHour = Math.ceil(currentHour / 4) * 4;

    if (nextHour > currentHour) {
      next.setHours(nextHour);
      next.setMinutes(0);
    } else {
      next.setHours(nextHour + 4);
      next.setMinutes(0);
    }

    next.setSeconds(0);
    next.setMilliseconds(0);
    return next;
  }

  if (cronExpression === '0 9 * * *') {
    // 9 AM daily
    if (next.getHours() >= 9) {
      next.setDate(next.getDate() + 1);
    }
    next.setHours(9);
    next.setMinutes(0);
    next.setSeconds(0);
    next.setMilliseconds(0);
    return next;
  }

  if (cronExpression === '0 10 * * 1') {
    // 10 AM on Mondays
    const currentDay = next.getDay();
    let daysUntilMonday = 1 - currentDay;

    if (daysUntilMonday <= 0 || (daysUntilMonday === 0 && next.getHours() >= 10)) {
      daysUntilMonday += 7;
    }

    next.setDate(next.getDate() + daysUntilMonday);
    next.setHours(10);
    next.setMinutes(0);
    next.setSeconds(0);
    next.setMilliseconds(0);
    return next;
  }

  if (cronExpression === '30 18 * * 5') {
    // 6:30 PM on Fridays
    const currentDay = next.getDay();
    let daysUntilFriday = 5 - currentDay;

    if (
      daysUntilFriday < 0 ||
      (daysUntilFriday === 0 &&
        (next.getHours() > 18 || (next.getHours() === 18 && next.getMinutes() >= 30)))
    ) {
      daysUntilFriday += 7;
    }

    next.setDate(next.getDate() + daysUntilFriday);
    next.setHours(18);
    next.setMinutes(30);
    next.setSeconds(0);
    next.setMilliseconds(0);
    return next;
  }

  // For other patterns, just add 1 hour as a fallback
  next.setHours(next.getHours() + 1);
  next.setMinutes(0);
  next.setSeconds(0);
  next.setMilliseconds(0);
  return next;
}

/**
 * Format a duration in milliseconds to a human-readable string
 * @param durationMs - Duration in milliseconds
 * @returns Formatted string like "2h 30m" or "45s"
 */
export function formatDuration(durationMs: number): string {
  const seconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    const remainingHours = hours % 24;
    return `${days}d ${remainingHours}h`;
  }

  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  }

  if (minutes > 0) {
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  }

  return `${seconds}s`;
}

/**
 * Check if two cron schedules might overlap
 * @param cron1 - First cron expression
 * @param cron2 - Second cron expression
 * @returns True if schedules might overlap
 */
export function checkScheduleOverlap(cron1: string, cron2: string): boolean {
  const parts1 = parseCronExpression(cron1);
  const parts2 = parseCronExpression(cron2);

  // If both run at the same minute and hour, check for day overlap
  if (parts1.minute === parts2.minute && parts1.hour === parts2.hour) {
    // Both use wildcards for days - they will overlap
    if (
      parts1.dayOfMonth === '*' &&
      parts2.dayOfMonth === '*' &&
      parts1.dayOfWeek === '*' &&
      parts2.dayOfWeek === '*'
    ) {
      return true;
    }

    // More complex overlap detection would go here
    // This is a simplified version
  }

  return false;
}

/**
 * Get human-readable description of a cron expression
 * @param cronExpression - Cron expression
 * @returns Human-readable description
 */
export function describeCronExpression(cronExpression: string): string {
  // Common patterns
  const descriptions: Record<string, string> = {
    '0 */4 * * *': 'Every 4 hours at the top of the hour',
    '0 9 * * *': 'Daily at 9:00 AM',
    '0 10 * * 1': 'Every Monday at 10:00 AM',
    '30 18 * * 5': 'Every Friday at 6:30 PM',
    '0 0 * * *': 'Daily at midnight',
    '0 12 * * *': 'Daily at noon',
    '0 0 * * 0': 'Every Sunday at midnight',
  };

  return descriptions[cronExpression] || `Custom schedule: ${cronExpression}`;
}

/**
 * Log schedule information
 */
export function logScheduleInfo(
  logger: ReturnType<typeof Logger.forService>,
  cronExpression: string,
  lastRun?: Date
): void {
  const description = describeCronExpression(cronExpression);
  const nextRun = getNextScheduledTime(cronExpression);

  logger.info('Schedule information', {
    expression: cronExpression,
    description,
    nextRun: nextRun.toISOString(),
    lastRun: lastRun?.toISOString(),
    timeUntilNext: formatDuration(nextRun.getTime() - Date.now()),
  });
}
