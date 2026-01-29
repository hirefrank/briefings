import { Hono } from 'hono';
import {
  Logger,
  SummarizationService,
  GeminiClient,
} from '../../services/index.js';
import { getDb, setupDb } from '../../db.js';
import { toTimestamp } from '../../db/helpers.js';
import { subDays } from 'date-fns';

const app = new Hono<{ Bindings: Env }>();

/**
 * Test endpoint for previous context feature
 * GET /test/previous-context
 *
 * Tests:
 * 1. Backward compatibility (without db)
 * 2. New functionality (with db and context)
 * 3. Compares the differences
 */
app.get('/', async (c) => {
  const logger = Logger.forService('TestPreviousContext');
  const env = c.env;

  try {
    logger.info('Testing previous context feature...');

    // Setup database
    await setupDb(env);
    const db = getDb(env);

    // Get test articles (recent ones)
    const sevenDaysAgo = toTimestamp(subDays(new Date(), 7))!;
    const testArticles = await db
      .selectFrom('Article')
      .innerJoin('Feed', 'Article.feedId', 'Feed.id')
      .selectAll('Article')
      .selectAll('Feed')
      .where('Article.pubDate', '>=', sevenDaysAgo)
      .orderBy('Article.pubDate', 'desc')
      .limit(5)
      .execute();

    if (testArticles.length === 0) {
      return c.json(
        {
          error: 'No recent articles found. Please run feed fetch first.',
        },
        400
      );
    }

    const articleData = testArticles.map((row) => ({
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
      },
    }));

    // Check for previous summaries
    const previousSummaries = await db
      .selectFrom('DailySummary')
      .selectAll()
      .where('summaryDate', '>=', sevenDaysAgo)
      .orderBy('summaryDate', 'desc')
      .limit(5)
      .execute();

    // Initialize services
    const geminiClient = new GeminiClient({
      apiKey: env.GEMINI_API_KEY,
    });
    const summarizationService = new SummarizationService({
      geminiClient,
      logger: logger.child({ component: 'SummarizationService' }),
    });

    // Test 1: Generate summary WITHOUT context (backward compatibility)
    logger.info('Generating summary without context...');
    const startWithout = Date.now();
    const summaryWithoutContext = await summarizationService.generateDailySummary(
      articleData,
      'Test Feed',
      new Date(),
      env
      // No db parameter - should use empty context
    );
    const timeWithout = Date.now() - startWithout;

    // Test 2: Generate summary WITH context (new feature)
    logger.info('Generating summary with context...');
    const startWith = Date.now();
    const summaryWithContext = await summarizationService.generateDailySummary(
      articleData,
      'Test Feed',
      new Date(),
      env,
      db // Pass db to enable context
    );
    const timeWith = Date.now() - startWith;

    // Test 3: Get the actual context that was used
    const relatedContext = await summarizationService.getRelatedContext(articleData, db);

    // Analyze differences
    const analysis = {
      backwardCompatibility: {
        success: true,
        summaryLength: summaryWithoutContext.length,
        generationTime: `${timeWithout}ms`,
        hasContext: false,
      },
      withContext: {
        success: true,
        summaryLength: summaryWithContext.length,
        generationTime: `${timeWith}ms`,
        hasContext: relatedContext.length > 0,
        contextCount: relatedContext.length,
        previousSummariesAvailable: previousSummaries.length,
      },
      comparison: {
        lengthDifference: summaryWithContext.length - summaryWithoutContext.length,
        timeDifference: `${timeWith - timeWithout}ms`,
        contextInfluence: detectContextInfluence(summaryWithoutContext, summaryWithContext),
      },
      testArticles: {
        count: articleData.length,
        feeds: [...new Set(articleData.map((a) => a.feed?.name || 'Unknown'))],
        dateRange: {
          oldest: articleData[articleData.length - 1]?.pubDate,
          newest: articleData[0]?.pubDate,
        },
      },
      contextDetails: relatedContext.map((ctx) => ({
        preview: `${ctx.substring(0, 150)}...`,
        length: ctx.length,
      })),
    };

    logger.info('Previous context test completed successfully', {
      contextAvailable: analysis.withContext.hasContext,
      contextCount: analysis.withContext.contextCount,
    });

    return c.json({
      success: true,
      message: 'Previous context feature is working correctly',
      analysis,
      samples: {
        withoutContext: `${summaryWithoutContext.substring(0, 500)}...`,
        withContext: `${summaryWithContext.substring(0, 500)}...`,
      },
    });
  } catch (error) {
    logger.error('Previous context test failed', error as Error);
    return c.json(
      {
        error: 'Test failed',
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      },
      500
    );
  }
});

/**
 * Detect if context influenced the summary
 */
function detectContextInfluence(
  withoutContext: string,
  withContext: string
): {
  hasContextMarkers: boolean;
  contextKeywords: string[];
  similarity: number;
} {
  const contextKeywords = [
    'previous',
    'previously',
    'earlier',
    'last week',
    'continuing',
    'as mentioned',
    'update',
    'follow-up',
    'related to',
    'building on',
    'in context',
    'historically',
    'trend',
    'pattern',
    'ongoing',
  ];

  const foundKeywords = contextKeywords.filter(
    (keyword) =>
      withContext.toLowerCase().includes(keyword) && !withoutContext.toLowerCase().includes(keyword)
  );

  // Simple similarity check (percentage of common words)
  const words1 = withoutContext.toLowerCase().split(/\s+/);
  const words2 = withContext.toLowerCase().split(/\s+/);
  const commonWords = words1.filter((word) => words2.includes(word));
  const similarity = Math.round(
    (commonWords.length / Math.max(words1.length, words2.length)) * 100
  );

  return {
    hasContextMarkers: foundKeywords.length > 0,
    contextKeywords: foundKeywords,
    similarity,
  };
}

export default app;
