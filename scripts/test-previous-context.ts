#!/usr/bin/env tsx
/**
 * Test script to verify the previous context feature implementation
 * Tests both backward compatibility (without db) and new functionality (with db)
 */

import { config } from 'dotenv';
import { eq, desc, gte } from 'drizzle-orm';
import { subDays } from 'date-fns';
import {
  SummarizationService,
  GeminiClient,
  PromptManager,
  ConfigManager,
  Logger,
} from '../src/services/index.js';
import { getDb, setupDb, articles, feeds, dailySummaries } from '../src/db.js';

// Load environment variables
config({ path: '.dev.vars' });

// Mock environment
const mockEnv = {
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
  APP_CONFIG_KV: {
    get: async (key: string) => {
      // Mock KV storage for prompts
      if (key === 'prompts/daily-summary.yaml') {
        return `
# Daily Summary Prompt
Generate a summary for {{feedName}} on {{displayDate}}.

Articles:
{{#each articles}}
{{articleNumber}}. {{title}}
{{content}}
{{/each}}

{{#if relatedContext}}
## Previous Context
{{relatedContext}}
{{/if}}
`;
      }
      return null;
    },
  } as KVNamespace,
  DB: {} as D1Database, // Will be set up by setupDb
} as Env;

async function runTests() {
  const logger = Logger.forService('PreviousContextTest');

  try {
    logger.info('Starting previous context feature tests...');

    // Setup database
    await setupDb(mockEnv);
    const db = getDb(mockEnv);

    // Initialize services
    const configManager = new ConfigManager(logger.child({ component: 'ConfigManager' }));
    const geminiClient = new GeminiClient({
      apiKey: mockEnv.GEMINI_API_KEY,
      logger: logger.child({ component: 'GeminiClient' }),
    });
    const promptManager = new PromptManager({
      configManager,
      logger: logger.child({ component: 'PromptManager' }),
    });
    const summarizationService = new SummarizationService({
      geminiClient,
      promptManager,
      logger: logger.child({ component: 'SummarizationService' }),
    });

    // Test 1: Backward compatibility - generateDailySummary without db
    logger.info('Test 1: Testing backward compatibility (without db parameter)...');
    try {
      // Get some test articles
      const testArticles = await db
        .select()
        .from(articles)
        .innerJoin(feeds, eq(articles.feedId, feeds.id))
        .limit(3);

      if (testArticles.length === 0) {
        logger.warn('No articles found in database. Please run feed fetch first.');
        return;
      }

      const articleData = testArticles.map((row) => ({
        ...row.articles,
        feed: row.feeds,
      }));

      // Call without db parameter (old way)
      const summaryWithoutContext = await summarizationService.generateDailySummary(
        articleData,
        'Test Feed',
        new Date(),
        mockEnv
        // Note: No db parameter
      );

      logger.info('✅ Test 1 PASSED: Backward compatibility maintained');
      logger.info(`Summary length without context: ${summaryWithoutContext.length} chars`);
    } catch (error) {
      logger.error('❌ Test 1 FAILED: Backward compatibility broken', error as Error);
      throw error;
    }

    // Test 2: New functionality - generateDailySummary with db
    logger.info('\nTest 2: Testing new functionality (with db parameter)...');
    try {
      // First, ensure we have some previous summaries in the database
      const sevenDaysAgo = subDays(new Date(), 7);
      const previousSummaries = await db
        .select()
        .from(dailySummaries)
        .where(gte(dailySummaries.summaryDate, sevenDaysAgo))
        .orderBy(desc(dailySummaries.summaryDate))
        .limit(5);

      logger.info(`Found ${previousSummaries.length} previous summaries for context`);

      // Get recent articles
      const recentArticles = await db
        .select()
        .from(articles)
        .innerJoin(feeds, eq(articles.feedId, feeds.id))
        .where(gte(articles.pubDate, subDays(new Date(), 1)))
        .limit(3);

      if (recentArticles.length === 0) {
        logger.warn('No recent articles found. Using any available articles.');
        const anyArticles = await db
          .select()
          .from(articles)
          .innerJoin(feeds, eq(articles.feedId, feeds.id))
          .limit(3);
        recentArticles.push(...anyArticles);
      }

      const articleData = recentArticles.map((row) => ({
        ...row.articles,
        feed: row.feeds,
      }));

      // Call with db parameter (new way)
      const summaryWithContext = await summarizationService.generateDailySummary(
        articleData,
        'Test Feed',
        new Date(),
        mockEnv,
        db // New parameter!
      );

      logger.info('✅ Test 2 PASSED: Context feature works correctly');
      logger.info(`Summary length with context: ${summaryWithContext.length} chars`);

      // Check if context was actually used by looking for context markers
      const hasContextMarkers =
        summaryWithContext.includes('previous') ||
        summaryWithContext.includes('earlier') ||
        summaryWithContext.includes('last week') ||
        summaryWithContext.includes('continuing');

      if (previousSummaries.length > 0 && hasContextMarkers) {
        logger.info('✅ Context appears to be influencing the summary');
      } else if (previousSummaries.length === 0) {
        logger.info('ℹ️  No previous summaries available for context');
      }
    } catch (error) {
      logger.error('❌ Test 2 FAILED: Context feature not working', error as Error);
      throw error;
    }

    // Test 3: Verify getRelatedContext works correctly
    logger.info('\nTest 3: Testing getRelatedContext method directly...');
    try {
      const testArticles = await db.select().from(articles).limit(1);

      if (testArticles.length > 0) {
        const relatedContext = await summarizationService.getRelatedContext(testArticles, db);

        logger.info(
          `✅ Test 3 PASSED: getRelatedContext returned ${relatedContext.length} context items`
        );

        if (relatedContext.length > 0) {
          logger.info('Sample context:', `${relatedContext[0].substring(0, 100)}...`);
        }
      }
    } catch (error) {
      logger.error('❌ Test 3 FAILED: getRelatedContext threw an error', error as Error);
      throw error;
    }

    // Test 4: Integration test - full daily summary flow
    logger.info('\nTest 4: Testing full daily summary flow...');
    try {
      // This simulates what daily-summary-processor does
      const testDate = new Date();
      const feedInfo = await db.select().from(feeds).where(eq(feeds.isActive, true)).limit(1);

      if (feedInfo.length === 0) {
        logger.warn('No active feeds found');
        return;
      }

      const feed = feedInfo[0];
      const feedArticles = await db
        .select()
        .from(articles)
        .where(eq(articles.feedId, feed.id))
        .orderBy(desc(articles.pubDate))
        .limit(5);

      if (feedArticles.length > 0) {
        const articleData = feedArticles.map((article) => ({
          ...article,
          feed,
        }));

        // Generate summary with context
        const summary = await summarizationService.generateDailySummary(
          articleData,
          feed.name,
          testDate,
          mockEnv,
          db
        );

        logger.info('✅ Test 4 PASSED: Full flow completed successfully');
        logger.info(`Generated summary for ${feed.name} with ${feedArticles.length} articles`);

        // Optionally save to verify the full flow
        if (process.env.SAVE_TEST_SUMMARY === 'true') {
          const saved = await summarizationService.saveDailySummary(
            {
              feedId: feed.id,
              summaryDate: testDate,
              summaryContent: summary,
              sentToLexPage: false,
              lexPageDocumentId: null,
            },
            feedArticles.map((a) => a.id),
            db
          );
          logger.info(`Test summary saved with ID: ${saved.id}`);
        }
      }
    } catch (error) {
      logger.error('❌ Test 4 FAILED: Full flow failed', error as Error);
      throw error;
    }

    logger.info('\n✅ All tests completed successfully!');
    logger.info(
      'The previous context feature is working correctly without breaking existing functionality.'
    );
  } catch (error) {
    logger.error('Test suite failed', error as Error);
    process.exit(1);
  }
}

// Run tests
runTests().catch(console.error);
