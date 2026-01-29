import { WorkersRSSParser } from './rss-parser-workers.js';
import { getDb, type Db } from '../../db.js';
import type { Feed, Article, NewArticle } from '../../db/types.js';
import { toTimestamp, toBool, fromBool } from '../../db/helpers.js';
import type { IFeedService, ParsedFeedItem, ILogger } from '../interfaces.js';
import { Logger } from '../../lib/logger.js';
import { FeedError, DatabaseError, ErrorCode } from '../../lib/errors.js';
import { parseISO, isValid } from 'date-fns';

/**
 * RSS feed parsing and article processing service
 */
export class FeedService implements IFeedService {
  private readonly logger: ILogger;
  private readonly parser: WorkersRSSParser;
  private dbCache: Db | null = null;

  constructor(options: { logger?: ILogger; configManager?: unknown }) {
    this.logger = options.logger || Logger.forService('FeedService');

    // Configure RSS parser for Cloudflare Workers
    this.parser = new WorkersRSSParser({
      timeout: 30000, // 30 second timeout
      headers: {
        'User-Agent': 'Briefings/1.0 (+https://github.com/yourusername/briefings)',
      },
    });
  }

  private getDb(env: Env): Db {
    if (!this.dbCache) {
      this.dbCache = getDb(env);
    }
    return this.dbCache;
  }

  /**
   * Get active feeds from database
   */
  async getActiveFeeds(env: Env): Promise<Feed[]> {
    try {
      const db = this.getDb(env);
      const activeFeeds = await db
        .selectFrom('Feed')
        .selectAll()
        .where('isActive', '=', 1)
        .execute();

      this.logger.info('Retrieved active feeds from database', {
        totalActive: activeFeeds.length,
        valid: activeFeeds.filter((f) => fromBool(f.isValid)).length,
        invalid: activeFeeds.filter((f) => !fromBool(f.isValid)).length,
      });

      // Check if we need to re-validate invalid feeds
      const invalidFeeds = activeFeeds.filter((f) => !fromBool(f.isValid));
      if (invalidFeeds.length > 0) {
        this.logger.info('Re-validating invalid feeds', {
          count: invalidFeeds.length,
          feeds: invalidFeeds.map((f) => ({ name: f.name, url: f.url })),
        });

        // Queue validation for invalid feeds
        const queueDispatcher = await import(
          '../../server-functions/utils/queue-dispatcher.js'
        ).then((m) => m.QueueDispatcher.create(env));

        // Send validation messages for invalid feeds
        const validationPromises = invalidFeeds.map((feed) =>
          queueDispatcher.sendFeedFetchMessage({
            feedUrl: feed.url,
            feedName: feed.name,
            feedId: feed.id,
            action: 'validate',
          })
        );

        // Fire and forget - don't wait for validation
        Promise.all(validationPromises).catch((error) => {
          this.logger.error('Failed to queue feed re-validation', error as Error);
        });
      }

      // Return only valid feeds for processing
      const validFeeds = activeFeeds.filter((f) => fromBool(f.isValid));

      this.logger.info('Returning valid active feeds', {
        count: validFeeds.length,
      });

      return validFeeds;
    } catch (error) {
      this.logger.error('Failed to get active feeds', error as Error);
      throw new FeedError('Failed to retrieve active feeds', ErrorCode.DATABASE_ERROR, {
        service: 'feed',
        operation: 'getActiveFeeds',
      });
    }
  }

  /**
   * Fetch and parse RSS feed
   */
  async fetchFeed(feedUrl: string): Promise<ParsedFeedItem[]> {
    try {
      this.logger.debug('Fetching RSS feed', { feedUrl });

      const feed = await this.parser.parseURL(feedUrl);

      if (!feed.items || feed.items.length === 0) {
        this.logger.warn('No items found in feed', { feedUrl });
        return [];
      }

      // Map RSS items to our interface
      const parsedItems: ParsedFeedItem[] = feed.items.map((item) => {
        const parsed: ParsedFeedItem = {
          title: item.title || 'Untitled',
          link: item.link || item.guid || '',
        };

        // Add optional properties if they exist
        if (item.content) parsed.content = item.content;
        if (item.contentSnippet) parsed.contentSnippet = item.contentSnippet;
        if (item.creator) parsed.creator = item.creator;
        if (item.isoDate) parsed.isoDate = item.isoDate;
        if (item.pubDate) parsed.pubDate = item.pubDate;

        return parsed;
      });

      this.logger.info('Successfully fetched RSS feed', {
        feedUrl,
        itemCount: parsedItems.length,
      });

      return parsedItems;
    } catch (error) {
      this.logger.error('Failed to fetch RSS feed', error as Error, {
        feedUrl,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
        errorName: error instanceof Error ? error.name : undefined,
      });

      // Check if it's a network or parsing error
      const errorMessage = error instanceof Error ? error.message : String(error);

      throw new FeedError(`Failed to parse RSS feed: ${errorMessage}`, ErrorCode.FEED_PARSE_ERROR, {
        service: 'feed',
        operation: 'fetchFeed',
        metadata: {
          feedUrl,
          originalError: errorMessage,
        },
      });
    }
  }

  /**
   * Process and save new articles
   */
  async processArticles(feedId: string, feedItems: ParsedFeedItem[], env: Env): Promise<Article[]> {
    if (feedItems.length === 0) {
      return [];
    }

    try {
      const db = this.getDb(env);

      // Get existing article URLs to check for duplicates
      const urls = feedItems.map((item) => item.link).filter(Boolean);

      // If no valid URLs, no need to check for duplicates
      const existingUrls = new Set<string>();
      if (urls.length > 0) {
        const existingArticles = await db
          .selectFrom('Article')
          .select('link')
          .where('link', 'in', urls as string[])
          .execute();

        existingArticles.forEach((a) => existingUrls.add(a.link));
      }

      // Filter out duplicates
      const newItems = feedItems.filter((item) => item.link && !existingUrls.has(item.link));

      if (newItems.length === 0) {
        this.logger.info('No new articles to process', {
          feedId,
          checkedCount: feedItems.length,
        });
        return [];
      }

      // Process and extract content from new articles
      const articlesToCreate: NewArticle[] = [];

      for (const item of newItems) {
        try {
          // Extract full content if available
          const extractedContent = await this.extractContent(item);

          // Parse publication date
          const pubDate = this.parseDate(item.isoDate || item.pubDate);

          const now = Date.now();
          articlesToCreate.push({
            id: crypto.randomUUID(),
            feedId,
            title: this.sanitizeText(item.title, 500) || 'Untitled',
            link: item.link || '',
            content: extractedContent || this.sanitizeText(item.content, 5000),
            contentSnippet: this.sanitizeText(
              item.contentSnippet || this.generateSnippet(extractedContent || item.content),
              500
            ),
            creator: this.sanitizeText(item.creator, 255),
            isoDate: item.isoDate || pubDate?.toISOString() || undefined,
            pubDate: toTimestamp(pubDate),
            processed: 0,
            createdAt: now,
            updatedAt: now,
          });
        } catch (error) {
          this.logger.warn('Failed to process article', {
            link: item.link,
            error: error instanceof Error ? error.message : String(error),
          });
          // Continue processing other articles
        }
      }

      if (articlesToCreate.length === 0) {
        return [];
      }

      // Insert articles one by one (returning)
      const insertedArticles: Article[] = [];
      for (const article of articlesToCreate) {
        const created = await db
          .insertInto('Article')
          .values(article)
          .returningAll()
          .executeTakeFirstOrThrow();
        insertedArticles.push(created);
      }

      this.logger.info('Successfully processed new articles', {
        feedId,
        newArticleCount: insertedArticles.length,
        duplicatesSkipped: feedItems.length - newItems.length,
      });

      return insertedArticles;
    } catch (error) {
      if (error instanceof DatabaseError) {
        throw error;
      }

      // Better error logging to capture the actual error
      const errorDetails = {
        feedId,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
        errorName: error instanceof Error ? error.name : undefined,
        errorType: error?.constructor?.name || typeof error,
      };

      this.logger.error('Failed to process articles', error as Error, errorDetails);

      throw new FeedError(
        `Failed to process articles: ${errorDetails.errorMessage}`,
        ErrorCode.FEED_FETCH_ERROR,
        {
          service: 'feed',
          operation: 'processArticles',
          metadata: { feedId, originalError: errorDetails.errorMessage },
        }
      );
    }
  }

  /**
   * Mark articles as processed
   */
  async markArticlesProcessed(articleIds: string[], env: Env): Promise<void> {
    if (articleIds.length === 0) {
      return;
    }

    try {
      const db = this.getDb(env);
      await db
        .updateTable('Article')
        .set({ processed: 1, updatedAt: Date.now() })
        .where('id', 'in', articleIds)
        .execute();

      this.logger.info('Marked articles as processed', {
        count: articleIds.length,
      });
    } catch (error) {
      this.logger.error('Failed to mark articles as processed', error as Error);
      throw new DatabaseError('Failed to mark articles as processed', ErrorCode.DATABASE_ERROR, {
        service: 'feed',
        operation: 'markArticlesProcessed',
        metadata: { articleIds },
      });
    }
  }

  /**
   * Get articles for a specific date range
   */
  async getArticlesForDate(
    date: Date,
    feedName: string | undefined,
    env: Env
  ): Promise<(Article & { feed: Feed })[]> {
    try {
      const db = this.getDb(env);
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);

      const startOfNextDay = new Date(date);
      startOfNextDay.setDate(startOfNextDay.getDate() + 1);
      startOfNextDay.setHours(0, 0, 0, 0);

      const startTs = toTimestamp(startOfDay)!;
      const endTs = toTimestamp(startOfNextDay)!;

      let query = db
        .selectFrom('Article')
        .innerJoin('Feed', 'Article.feedId', 'Feed.id')
        .selectAll('Article')
        .selectAll('Feed')
        .where('Article.pubDate', '>=', startTs)
        .where('Article.pubDate', '<', endTs)
        .orderBy('Article.pubDate', 'desc');

      if (feedName) {
        // Find feed by name and filter
        const feed = await db
          .selectFrom('Feed')
          .selectAll()
          .where('name', '=', feedName)
          .limit(1)
          .executeTakeFirst();

        if (feed) {
          query = query.where('Article.feedId', '=', feed.id);
        }
      }

      const rows = await query.execute();

      // Map joined rows to the expected shape
      return rows.map((row) => ({
        id: row.id,
        feedId: row.feedId,
        title: row.title,
        link: row.link,
        content: row.content,
        contentSnippet: row.contentSnippet,
        creator: row.creator,
        isoDate: row.isoDate,
        pubDate: row.pubDate,
        processed: row.processed,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        feed: {
          id: (row as any).id,
          name: row.name,
          url: row.url,
          category: row.category,
          isActive: row.isActive,
          isValid: row.isValid,
          validationError: row.validationError,
          lastFetchedAt: row.lastFetchedAt,
          lastError: row.lastError,
          errorCount: row.errorCount,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        } as Feed,
      })) as (Article & { feed: Feed })[];
    } catch (error) {
      this.logger.error('Failed to get articles for date', error as Error, { date, feedName });
      throw new DatabaseError('Failed to retrieve articles for date', ErrorCode.DATABASE_ERROR, {
        service: 'feed',
        operation: 'getArticlesForDate',
        metadata: { date, feedName },
      });
    }
  }

  /**
   * Extract content from article (simplified for Workers)
   */
  private async extractContent(item: ParsedFeedItem): Promise<string | undefined> {
    if (!item.content) {
      return undefined;
    }

    try {
      // Simple HTML stripping for Workers environment
      // Remove HTML tags and decode entities
      const text = item.content
        .replace(/<[^>]*>/g, '') // Remove HTML tags
        .replace(/&nbsp;/g, ' ') // Replace non-breaking spaces
        .replace(/&amp;/g, '&') // Decode ampersands
        .replace(/&lt;/g, '<') // Decode less than
        .replace(/&gt;/g, '>') // Decode greater than
        .replace(/&quot;/g, '"') // Decode quotes
        .replace(/&#39;/g, "'") // Decode apostrophes
        .replace(/\s+/g, ' ') // Normalize whitespace
        .trim();

      return text || undefined;
    } catch (error) {
      this.logger.debug('Failed to extract content', {
        link: item.link,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  /**
   * Parse date from various formats
   */
  private parseDate(dateString?: string): Date | null {
    if (!dateString) return null;

    try {
      const date = parseISO(dateString);
      return isValid(date) ? date : null;
    } catch {
      try {
        const date = new Date(dateString);
        return isValid(date) ? date : null;
      } catch {
        return null;
      }
    }
  }

  /**
   * Sanitize and truncate text
   */
  private sanitizeText(text?: string, maxLength?: number): string | undefined {
    if (!text) return undefined;

    // Remove excessive whitespace
    let sanitized = text.trim().replace(/\s+/g, ' ');

    // Truncate if needed
    if (maxLength && sanitized.length > maxLength) {
      sanitized = `${sanitized.substring(0, maxLength - 3)}...`;
    }

    return sanitized;
  }

  /**
   * Generate snippet from content
   */
  private generateSnippet(content?: string): string | undefined {
    if (!content) return undefined;

    // Remove HTML tags and get first 200 characters
    const text = content.replace(/<[^>]*>/g, '');
    return this.sanitizeText(text, 200);
  }

  /**
   * Update feed timestamp after successful fetch
   * This marks when the feed was last successfully fetched
   */
  async updateFeedTimestamp(feedId: string, env: Env): Promise<void> {
    try {
      const db = getDb(env);

      await db
        .updateTable('Feed')
        .set({
          lastFetchedAt: Date.now(),
          lastError: null,
          errorCount: 0,
          updatedAt: Date.now(),
        })
        .where('id', '=', feedId)
        .execute();

      this.logger.debug('Feed timestamp updated successfully', {
        feedId,
        lastFetchedAt: new Date().toISOString(),
      });
    } catch (error) {
      this.logger.error('Failed to update feed timestamp', error as Error, {
        feedId,
      });

      throw new DatabaseError('Failed to update feed timestamp', ErrorCode.DATABASE_ERROR, {
        operation: 'update_feed_timestamp',
      });
    }
  }

  /**
   * Update feed error information when fetch fails
   */
  async updateFeedError(feedId: string, errorMessage: string, env: Env): Promise<void> {
    try {
      const db = getDb(env);

      // Get current error count
      const currentFeed = await db
        .selectFrom('Feed')
        .select('errorCount')
        .where('id', '=', feedId)
        .limit(1)
        .executeTakeFirst();

      const newErrorCount = (currentFeed?.errorCount || 0) + 1;

      await db
        .updateTable('Feed')
        .set({
          lastError: errorMessage,
          errorCount: newErrorCount,
          updatedAt: Date.now(),
        })
        .where('id', '=', feedId)
        .execute();

      this.logger.debug('Feed error information updated', {
        feedId,
        errorMessage,
        errorCount: newErrorCount,
      });
    } catch (error) {
      this.logger.error('Failed to update feed error information', error as Error, {
        feedId,
        errorMessage,
      });

      // Don't throw here - we don't want to mask the original error
    }
  }
}
