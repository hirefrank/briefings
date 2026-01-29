import type { IFeedService, ISummarizationService, ILogger } from './interfaces.js';
import type { Db } from '../db.js';
import type { DailySummary } from '../db/types.js';
import { toTimestamp, fromTimestamp } from '../db/helpers.js';
import { format } from 'date-fns';

/**
 * Task: Fetch all active feeds
 */
export async function fetchAllFeedsTask(
  feedService: IFeedService,
  db: Db,
  env: Env,
  logger: ILogger
): Promise<number> {
  logger.info('Task: Starting feed fetch for all sources...');
  try {
    const activeFeeds = await feedService.getActiveFeeds(env);
    let totalNewArticles = 0;

    for (const feed of activeFeeds) {
      try {
        logger.info(`Fetching feed: ${feed.name} (${feed.url})`);
        const feedItems = await feedService.fetchFeed(feed.url);

        if (feedItems.length > 0) {
          const articles = await feedService.processArticles(String(feed.id), feedItems, env);
          totalNewArticles += articles.length;
          logger.info(`Processed ${articles.length} new articles from ${feed.name}`);
        }
      } catch (error) {
        logger.error(`Failed to fetch feed ${feed.name}`, error as Error);
        // Continue with other feeds
      }
    }

    logger.info(`Task: Feed fetch completed. Added ${totalNewArticles} new articles.`);
    return totalNewArticles;
  } catch (error) {
    logger.error('Task: Error during feed fetch task.', error as Error);
    throw error;
  }
}

/**
 * Task: Generate daily summary
 */
export interface DailySummaryTaskOptions {
  date?: Date;
  feedName?: string;
  forceRegenerate?: boolean;
}

export async function generateDailySummaryTask(
  summarizationService: ISummarizationService,
  feedService: IFeedService,
  db: Db,
  env: Env,
  logger: ILogger,
  options: DailySummaryTaskOptions = {}
): Promise<string | null> {
  const targetDate = options.date || new Date();
  const feedName = options.feedName;
  const forceRegenerate = options.forceRegenerate || false;

  logger.info(
    `Task: Generating daily summary for ${format(targetDate, 'yyyy-MM-dd')}${feedName ? ` (${feedName})` : ''}${forceRegenerate ? ' (forcing regeneration)' : ''}...`
  );

  try {
    // Check if summary already exists
    if (!forceRegenerate) {
      const targetTs = toTimestamp(targetDate);
      const existingSummary = await db
        .selectFrom('DailySummary')
        .selectAll()
        .where('summaryDate', '=', targetTs!)
        .limit(1)
        .executeTakeFirst();

      if (existingSummary) {
        logger.info('Daily summary already exists, skipping generation');
        return existingSummary.id;
      }
    }

    // Get articles for the date
    const articles = await feedService.getArticlesForDate(targetDate, feedName, env);

    if (articles.length === 0) {
      logger.info('No articles found for the specified date');
      return null;
    }

    // Get feedId from the first article or use a default
    const feedId = articles[0]?.feedId || 'default';

    // Generate summary content
    const summaryContent = await summarizationService.generateDailySummary(
      articles,
      feedName || 'All Feeds',
      targetDate,
      env,
      db
    );

    // Save summary
    const savedSummary = await summarizationService.saveDailySummary(
      {
        feedId,
        summaryDate: toTimestamp(targetDate)!,
        summaryContent,
        structuredContent: null,
        schemaVersion: '1.0',
        sentiment: null,
        topicsList: null,
        entityList: null,
        articleCount: articles.length,
      },
      articles.map((a) => a.id),
      db
    );

    logger.info(`Task: Daily summary generated successfully. ID: ${savedSummary.id}`);
    return savedSummary.id;
  } catch (error) {
    logger.error(
      `Task: Error during daily summary generation for ${format(targetDate, 'yyyy-MM-dd')}.`,
      error as Error
    );
    throw error;
  }
}

/**
 * Task: Generate weekly summary
 */
export interface WeeklySummaryTaskOptions {
  endDate?: Date;
  filterTopics?: string[];
  forceRegenerate?: boolean;
  skipDbSave?: boolean;
}

export async function generateWeeklySummaryTask(
  summarizationService: ISummarizationService,
  db: Db,
  env: Env,
  logger: ILogger,
  options: WeeklySummaryTaskOptions = {}
): Promise<string | null> {
  const endDate = options.endDate || new Date();
  const filterTopics = options.filterTopics;
  const forceRegenerate = options.forceRegenerate || false;
  const skipDbSave = options.skipDbSave || false;

  // Calculate week start date (7 days before end date)
  const weekStartDate = new Date(endDate);
  weekStartDate.setDate(weekStartDate.getDate() - 6);

  logger.info(
    `Task: Generating weekly summary for ${format(weekStartDate, 'yyyy-MM-dd')} to ${format(endDate, 'yyyy-MM-dd')}${filterTopics ? `. Topics: ${filterTopics.join(', ')}` : ''}${skipDbSave ? ' (skip DB save)' : ''}${forceRegenerate ? ' (forcing regeneration)' : ''}...`
  );

  try {
    const weekStartTs = toTimestamp(weekStartDate)!;
    const endTs = toTimestamp(endDate)!;

    // Check if summary already exists
    if (!forceRegenerate && !skipDbSave) {
      const existingSummary = await db
        .selectFrom('WeeklySummary')
        .selectAll()
        .where('weekStartDate', '=', weekStartTs)
        .where('weekEndDate', '=', endTs)
        .limit(1)
        .executeTakeFirst();

      if (existingSummary) {
        logger.info('Weekly summary already exists, skipping generation');
        return existingSummary.id;
      }
    }

    // Get daily summaries for the week
    const dailySummariesList = await db
      .selectFrom('DailySummary')
      .selectAll()
      .where('summaryDate', '>=', weekStartTs)
      .where('summaryDate', '<=', endTs)
      .orderBy('summaryDate')
      .execute();

    if (dailySummariesList.length === 0) {
      logger.info('No daily summaries found for the specified week');
      return null;
    }

    // Generate weekly recap
    const recapContent = await summarizationService.generateWeeklyRecap(
      dailySummariesList,
      { start: weekStartDate, end: endDate },
      env
    );

    // Parse metadata and sections (single-pass workflow)
    const { title, topics, cleanContent } = summarizationService.parseDigestMetadata(recapContent);
    const sections = summarizationService.parseRecapSections(cleanContent);

    if (skipDbSave) {
      logger.info('Skipping database save as requested');
      return null;
    }

    // Save weekly summary
    const savedSummary = await summarizationService.saveWeeklySummary(
      {
        weekStartDate: weekStartTs,
        weekEndDate: endTs,
        title,
        recapContent: sections.recapContent,
        belowTheFoldContent: sections.belowTheFold || null,
        soWhatContent: sections.soWhat || null,
        topics: topics.length > 0 ? JSON.stringify(topics) : null,
        sentAt: null,
      },
      dailySummariesList.map((ds) => ds.id),
      db
    );

    logger.info(`Task: Weekly summary generated successfully. ID: ${savedSummary.id}`);
    return savedSummary.id;
  } catch (error) {
    logger.error(
      `Task: Error during weekly summary generation for week ending ${format(endDate, 'yyyy-MM-dd')}.`,
      error as Error
    );
    throw error;
  }
}
