/**
 * Consolidated Weekly Digest Queue Consumer
 *
 * Combines the 5-stage pipeline into a single consumer:
 * 1. Fetch daily summaries for the week
 * 2. Fetch historical digests from R2 for context
 * 3. Generate weekly recap content
 * 4. Extract topics and generate title
 * 5. Save to database
 * 6. Store to R2 for future context
 * 7. Send email via Resend (if enabled)
 */

import type { MessageBatch, Message } from '@cloudflare/workers-types';
import { Logger } from '../../lib/logger.js';
import { ApiError, DatabaseError, ErrorCode } from '../../lib/errors.js';
import {
  SummarizationService,
  GeminiClient,
} from '../../services/index.js';
import { getDb, setupDb, dailySummaries, weeklySummaries } from '../../db.js';
import { and, gte, lte, desc, eq } from 'drizzle-orm';
import { createR2Storage } from '../../lib/r2.js';
import { createEmailService } from '../../lib/email.js';
import { subDays, format } from 'date-fns';

// Message type for weekly digest
export interface WeeklyDigestMessage {
  id: string;
  requestId: string;
  weekEndDate: string; // ISO date string (typically Sunday)
  forceRegenerate?: boolean;
  timestamp: string;
}

/**
 * Weekly digest queue consumer
 */
export async function queue(
  batch: MessageBatch<WeeklyDigestMessage>,
  env: Env
): Promise<void> {
  const logger = Logger.forService('WeeklyDigestConsumer');

  logger.info('Processing weekly digest batch', {
    messageCount: batch.messages.length,
  });

  // Setup database
  await setupDb(env);

  // Process messages sequentially (AI rate limits)
  for (const message of batch.messages) {
    try {
      await processWeeklyDigest(message as Message<WeeklyDigestMessage>, env, logger);
      message.ack();
    } catch (error) {
      logger.error('Weekly digest failed', error as Error, {
        messageId: message.body.requestId,
      });

      const shouldRetry = isRetryableError(error);
      if (!shouldRetry) {
        message.ack(); // Don't retry permanent errors
      }
    }
  }
}

async function processWeeklyDigest(
  message: Message<WeeklyDigestMessage>,
  env: Env,
  logger: ReturnType<typeof Logger.forService>
): Promise<void> {
  const startTime = Date.now();
  const data = message.body;

  logger.info('Processing weekly digest', {
    requestId: data.requestId,
    weekEndDate: data.weekEndDate,
    forceRegenerate: data.forceRegenerate,
  });

  const db = getDb(env);

  // Calculate week date range
  const weekEnd = new Date(data.weekEndDate);
  const weekStart = subDays(weekEnd, 6); // 7 days total

  // ========================================
  // STEP 1: Fetch daily summaries for the week
  // ========================================
  logger.info('Fetching daily summaries for the week', {
    weekStart: weekStart.toISOString(),
    weekEnd: weekEnd.toISOString(),
  });

  const dailySummaryRows = await db
    .select()
    .from(dailySummaries)
    .where(
      and(
        gte(dailySummaries.summaryDate, weekStart),
        lte(dailySummaries.summaryDate, weekEnd)
      )
    )
    .orderBy(desc(dailySummaries.summaryDate));

  if (dailySummaryRows.length === 0) {
    throw new ApiError(
      'No daily summaries found for the week',
      ErrorCode.API_NOT_FOUND,
      404
    );
  }

  logger.info('Found daily summaries', {
    count: dailySummaryRows.length,
  });

  // ========================================
  // STEP 2: Fetch historical context from R2
  // ========================================
  try {
    const r2Storage = createR2Storage(env.MARKDOWN_OUTPUT_R2);
    const context = await r2Storage.buildDigestContext(4); // Last 4 weeks

    if (context.recentTitles.length > 0) {
      logger.info('Built digest context from R2', {
        digestCount: context.digestCount,
        recentTitles: context.recentTitles.length,
        recentTopics: context.recentTopics.length,
      });
    }
  } catch (error) {
    logger.warn('Failed to fetch R2 context, proceeding without', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // ========================================
  // STEP 3: Initialize services and generate
  // ========================================
  const geminiClient = new GeminiClient({
    apiKey: env.GEMINI_API_KEY,
  });
  const summarizationService = new SummarizationService({
    geminiClient,
    logger: logger.child({ component: 'SummarizationService' }),
  });

  // Format summaries for the recap generation
  const summariesForRecap = dailySummaryRows.map(row => ({
    id: row.id,
    date: row.summaryDate instanceof Date ? row.summaryDate.toISOString() : String(row.summaryDate),
    content: row.summaryContent,
    feedId: row.feedId,
  }));

  // Generate the weekly recap
  logger.info('Generating weekly recap');

  const recapContent = await summarizationService.generateWeeklyRecap(
    summariesForRecap as any,
    { start: weekStart, end: weekEnd },
    env
  );

  // ========================================
  // STEP 4: Extract topics and generate title
  // ========================================
  logger.info('Extracting topics and generating title');

  const topics = await summarizationService.extractTopics(recapContent, env);
  const title = await summarizationService.generateTitle(recapContent, topics, env);

  // Parse recap sections
  const sections = summarizationService.parseRecapSections(recapContent);

  // ========================================
  // STEP 5: Save to database
  // ========================================
  logger.info('Saving weekly summary to database');

  const weeklyData = {
    weekStartDate: weekStart,
    weekEndDate: weekEnd,
    title,
    recapContent: sections.recapContent,
    belowTheFoldContent: sections.belowTheFoldContent || null,
    soWhatContent: sections.soWhatContent || null,
    topics: topics.join(', '),
    sentAt: null,
  };

  const savedSummary = await summarizationService.saveWeeklySummary(
    weeklyData as any,
    dailySummaryRows.map(s => s.id),
    db
  );

  // ========================================
  // STEP 6: Store to R2 for future context
  // ========================================
  try {
    const r2Storage = createR2Storage(env.MARKDOWN_OUTPUT_R2);

    await r2Storage.storeDigest({
      weekStart: format(weekStart, 'yyyy-MM-dd'),
      weekEnd: format(weekEnd, 'yyyy-MM-dd'),
      title,
      topics,
      recapContent: sections.recapContent,
      generatedAt: new Date().toISOString(),
    });

    logger.info('Stored digest to R2 for future context');
  } catch (error) {
    logger.warn('Failed to store digest to R2', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // ========================================
  // STEP 7: Send email via Resend (if enabled)
  // ========================================
  if (env.RESEND_API_KEY && env.EMAIL_TO && env.EMAIL_FROM) {
    try {
      logger.info('Sending weekly digest email');

      const emailService = createEmailService(env.RESEND_API_KEY, env.EMAIL_FROM);

      // Parse recipient emails (comma-separated)
      const recipients = env.EMAIL_TO.split(',').map((email: string) => ({
        email: email.trim(),
      }));

      const emailResult = await emailService.sendWeeklyDigest({
        to: recipients,
        title,
        content: recapContent,
        weekStart: format(weekStart, 'yyyy-MM-dd'),
        weekEnd: format(weekEnd, 'yyyy-MM-dd'),
      });

      if (emailResult.success) {
        logger.info('Email sent successfully', {
          messageId: emailResult.messageId,
          recipients: recipients.map((r: { email: string }) => r.email),
        });

        // Update sentAt timestamp
        await db
          .update(weeklySummaries)
          .set({ sentAt: new Date() })
          .where(eq(weeklySummaries.id, savedSummary.id));

        logger.info('Updated sentAt timestamp');
      } else {
        logger.error('Failed to send email', new Error(emailResult.error || 'Unknown error'));
      }
    } catch (error) {
      logger.error('Email sending failed', error as Error, {
        summaryId: savedSummary.id,
        error: error instanceof Error ? error.message : String(error),
      });
      // Don't throw - email failure shouldn't block the entire process
    }
  } else {
    logger.info('Email sending disabled', {
      hasApiKey: !!env.RESEND_API_KEY,
      hasEmailTo: !!env.EMAIL_TO,
      hasEmailFrom: !!env.EMAIL_FROM,
    });
  }

  const duration = Date.now() - startTime;

  logger.info('Weekly digest completed', {
    requestId: data.requestId,
    summaryId: savedSummary.id,
    title,
    topicCount: topics.length,
    dailySummaryCount: dailySummaryRows.length,
    emailSent: !!(env.RESEND_API_KEY && env.EMAIL_TO && env.EMAIL_FROM),
    duration,
  });
}

/**
 * Determine if an error should trigger a retry
 */
function isRetryableError(error: unknown): boolean {
  // Don't retry validation errors
  if (error && typeof error === 'object' && 'name' in error && error.name === 'ValidationError') {
    return false;
  }

  // Don't retry NOT_FOUND errors
  if (error instanceof ApiError && error.statusCode === 404) {
    return false;
  }

  // Retry rate limit errors
  if (error instanceof ApiError && error.statusCode === 429) {
    return true;
  }

  // Retry database connection errors
  if (error instanceof DatabaseError) {
    return true;
  }

  // Retry network errors
  const retryablePatterns = [
    /timeout/i,
    /network/i,
    /connection/i,
    /ECONNRESET/i,
    /rate limit/i,
    /quota/i,
  ];

  const errorMessage = error instanceof Error ? error.message : String(error);
  return retryablePatterns.some((pattern) => pattern.test(errorMessage));
}
