// @ts-nocheck - Legacy code with type mismatches, needs refactoring
import type {
  ISummarizationService,
  IGeminiClient,
  ILogger,
} from '../interfaces.js';
import type {
  StructuredDailySummary,
  GeneratedStructuredContent,
} from '../../types/structured-summary.js';
import { SummaryAdapter } from './summary-adapter.js';
// Env type is globally defined
import type { Db, articles, dailySummaries, weeklySummaries } from '../../db.js';
import { eq, and, gte, lt, desc } from 'drizzle-orm';
import type { InferSelectModel } from 'drizzle-orm';
import { Logger } from '../../lib/logger.js';
import { ApiError, DatabaseError, ErrorCode } from '../../lib/errors.js';
import { format, subDays, parseISO } from 'date-fns';
import { DEFAULT_MODELS } from '../../lib/constants.js';
import { renderPrompt, getPrompt } from '../../lib/prompts.js';

type Article = InferSelectModel<typeof articles> & {
  feed?: InferSelectModel<typeof import('../../db.js').feeds>;
};
type DailySummary = InferSelectModel<typeof dailySummaries>;
type WeeklySummary = InferSelectModel<typeof weeklySummaries>;

/**
 * Service for generating and managing article summaries
 */
export class SummarizationService implements ISummarizationService {
  private readonly geminiClient: IGeminiClient;
  private readonly logger: ILogger;

  constructor(options: {
    geminiClient: IGeminiClient;
    logger?: ILogger;
  }) {
    this.geminiClient = options.geminiClient;
    this.logger = options.logger || Logger.forService('SummarizationService');
  }

  /**
   * Generate a structured daily summary for a set of articles
   */
  async generateStructuredDailySummary(
    articles: Article[],
    feedName: string,
    date: Date,
    env: Env,
    db?: Db
  ): Promise<StructuredDailySummary> {
    const startTime = Date.now();

    try {
      this.logger.info('Generating structured daily summary', {
        feedName,
        date: format(date, 'yyyy-MM-dd'),
        articleCount: articles.length,
      });

      if (articles.length === 0) {
        // Return minimal structured summary for empty case
        return this.createEmptyStructuredSummary(feedName, date, startTime);
      }

      // Limit articles to prevent token limit issues
      const MAX_ARTICLES_PER_SUMMARY = 10;
      const articlesToSummarize = articles.slice(0, MAX_ARTICLES_PER_SUMMARY);

      if (articles.length > MAX_ARTICLES_PER_SUMMARY) {
        this.logger.warn('Too many articles for single summary', {
          feedName,
          totalArticles: articles.length,
          summarizing: MAX_ARTICLES_PER_SUMMARY,
        });
      }

      // Get related context from previous summaries
      const relatedContext = db ? await this.getRelatedContext(articles, db) : [];

      // Build structured prompt for AI generation
      const prompt = await this.buildStructuredPrompt(
        articlesToSummarize,
        feedName,
        date,
        relatedContext
      );

      // Generate structured content with AI
      const generatedContent = await this.geminiClient.generateJSON<GeneratedStructuredContent>(
        prompt,
        {
          model: DEFAULT_MODELS.DAILY_SUMMARY,
          temperature: 0.7,
          maxOutputTokens: 16384,
        }
      );

      // Assemble complete structured summary
      const structuredSummary = this.assembleStructuredSummary(
        generatedContent,
        articlesToSummarize,
        feedName,
        date,
        startTime
      );

      this.logger.info('Structured daily summary generated successfully', {
        feedName,
        date: format(date, 'yyyy-MM-dd'),
        processingTime: Date.now() - startTime,
        topicCount: structuredSummary.insights.topics.length,
        entityCount: structuredSummary.insights.entities.length,
        quoteCount: structuredSummary.insights.quotes.length,
      });

      return structuredSummary;
    } catch (error) {
      this.logger.error('Failed to generate structured daily summary', error as Error, {
        feedName,
        date: format(date, 'yyyy-MM-dd'),
        processingTime: Date.now() - startTime,
      });

      throw new ApiError(
        `Failed to generate structured daily summary: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ErrorCode.SUMMARIZATION_ERROR,
        500,
        {
          service: 'summarization',
          operation: 'generateStructuredDailySummary',
          metadata: {
            feedName,
            date: date.toISOString(),
            originalError:
              error instanceof Error
                ? {
                    message: error.message,
                    name: error.name,
                    stack: error.stack,
                  }
                : String(error),
          },
        }
      );
    }
  }

  /**
   * Generate a daily summary for a set of articles (legacy method - maintains backward compatibility)
   */
  async generateDailySummary(
    articles: Article[],
    feedName: string,
    date: Date,
    env: Env,
    db?: Db
  ): Promise<string> {
    try {
      this.logger.info('Generating daily summary', {
        feedName,
        date: format(date, 'yyyy-MM-dd'),
        articleCount: articles.length,
      });

      if (articles.length === 0) {
        return '# No Articles\n\nNo articles were found for this date.';
      }

      // Limit articles to prevent token limit issues
      const MAX_ARTICLES_PER_SUMMARY = 10; // Increase back since model has 1M token limit
      const articlesToSummarize = articles.slice(0, MAX_ARTICLES_PER_SUMMARY);

      if (articles.length > MAX_ARTICLES_PER_SUMMARY) {
        this.logger.warn('Too many articles for single summary', {
          feedName,
          totalArticles: articles.length,
          summarizing: MAX_ARTICLES_PER_SUMMARY,
        });
      }

      // Get related context from previous summaries
      const relatedContext = db ? await this.getRelatedContext(articles, db) : [];

      // Build context for template
      const templateContext = {
        feedName,
        date: format(date, 'yyyy-MM-dd'),
        displayDate: format(date, 'EEEE, MMMM d, yyyy'),
        articles: articlesToSummarize.map((article, index) => {
          const content = article.content || article.contentSnippet || '';
          // Truncate individual article content to prevent token limits
          const MAX_ARTICLE_CONTENT_LENGTH = 2000; // Per article limit
          const truncatedContent =
            content.length > MAX_ARTICLE_CONTENT_LENGTH
              ? `${content.substring(0, MAX_ARTICLE_CONTENT_LENGTH - 3)}...`
              : content;

          return {
            title: article.title,
            link: article.link,
            content: truncatedContent,
            contentSnippet: truncatedContent, // Use same truncated content
            creator: article.creator,
            pubDate: article.pubDate ? format(article.pubDate, 'PPpp') : null,
            articleNumber: index + 1,
          };
        }),
        articleCount: articlesToSummarize.length,
        relatedContext: relatedContext.join('\n\n'),
      };

      // Render the prompt
      const prompt = renderPrompt(getPrompt('daily-summary'), templateContext);

      // Generate summary with AI
      let summary: string;
      try {
        const response = await this.geminiClient.generateContent(prompt, {
          model: DEFAULT_MODELS.DAILY_SUMMARY,
          temperature: 0.7,
          maxOutputTokens: 16384, // Model supports much higher output
        });
        summary = this.formatMarkdown(response.text);
      } catch (error) {
        // If AI fails, create a simple fallback summary
        if (error instanceof Error && error.message.includes('No text content')) {
          this.logger.warn('AI returned empty response, using fallback summary', {
            feedName,
            articleCount: articlesToSummarize.length,
          });

          // Create a simple summary listing the articles
          const fallbackSummary = articlesToSummarize
            .map((article) => {
              const title = article.title || 'Untitled';
              const link = article.link || '#';
              const snippet = (article.content || article.contentSnippet || '').substring(0, 200);
              return `* [${title}](${link}): ${snippet}${snippet.length >= 200 ? '...' : ''}`;
            })
            .join('\n\n');

          summary =
            fallbackSummary || '# No Articles\n\nNo articles were available for summarization.';
        } else {
          throw error;
        }
      }

      this.logger.info('Daily summary generated successfully', {
        feedName,
        date: format(date, 'yyyy-MM-dd'),
        summaryLength: summary.length,
      });

      return summary;
    } catch (error) {
      this.logger.error('Failed to generate daily summary', error as Error, {
        feedName,
        date: format(date, 'yyyy-MM-dd'),
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
        errorName: error instanceof Error ? error.name : undefined,
        errorDetails: error,
      });

      throw new ApiError(
        `Failed to generate daily summary: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ErrorCode.SUMMARIZATION_ERROR,
        500,
        {
          service: 'summarization',
          operation: 'generateDailySummary',
          metadata: {
            feedName,
            date: date.toISOString(),
            originalError:
              error instanceof Error
                ? {
                    message: error.message,
                    name: error.name,
                    stack: error.stack,
                  }
                : String(error),
          },
        }
      );
    }
  }

  /**
   * Save a daily summary to the database
   */
  async saveDailySummary(
    summary: Omit<DailySummary, 'id' | 'createdAt' | 'updatedAt'>,
    articleIds: string[],
    db: Db
  ): Promise<DailySummary> {
    try {
      // Import schema tables
      const { dailySummaries, articleSummaryRelations } = await import('../../db.js');

      // Insert the summary
      const [savedSummary] = await db
        .insert(dailySummaries)
        .values({
          feedId: summary.feedId,
          summaryDate: summary.summaryDate,
          summaryContent: summary.summaryContent,
          sentToLexPage: summary.sentToLexPage || false,
          lexPageDocumentId: summary.lexPageDocumentId,
        })
        .returning();

      // Create article-summary relations
      if (articleIds.length > 0) {
        await db.insert(articleSummaryRelations).values(
          articleIds.map((articleId) => ({
            articleId,
            dailySummaryId: savedSummary.id,
          }))
        );
      }

      this.logger.info('Daily summary saved', {
        summaryId: savedSummary.id,
        summaryDate: summary.summaryDate,
        articleCount: articleIds.length,
      });

      return savedSummary;
    } catch (error) {
      this.logger.error('Failed to save daily summary', error as Error, {
        feedId: summary.feedId,
        summaryDate: summary.summaryDate,
        error,
      });

      // Check if this is a unique constraint violation
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorCause = (error as { cause?: { message?: string } })?.cause?.message || '';

      if (
        errorMessage.includes('UNIQUE constraint failed') ||
        errorCause.includes('UNIQUE constraint failed') ||
        errorMessage.includes('DailySummary_feedId_summaryDate_key')
      ) {
        // Get feed name for better error message
        const { feeds } = await import('../../db.js');
        const [feed] = await db
          .select({ name: feeds.name })
          .from(feeds)
          .where(eq(feeds.id, summary.feedId));

        const feedName = feed?.name || 'Unknown Feed';
        const dateStr = format(summary.summaryDate, 'yyyy-MM-dd');

        throw new DatabaseError(
          `Daily summary already exists for ${feedName} on ${dateStr}. Use 'force' option to regenerate.`,
          ErrorCode.DUPLICATE_ENTRY,
          {
            service: 'summarization',
            operation: 'saveDailySummary',
            metadata: {
              feedId: summary.feedId,
              feedName,
              summaryDate: dateStr,
              suggestion: 'Use force=true to regenerate or choose a different date',
            },
          }
        );
      }

      throw new DatabaseError('Failed to save daily summary', ErrorCode.DATABASE_ERROR, {
        service: 'summarization',
        operation: 'saveDailySummary',
        metadata: {
          summaryDate: summary.summaryDate,
          originalError: errorMessage,
        },
      });
    }
  }

  /**
   * Get related context from previous summaries
   */
  async getRelatedContext(articles: Article[], db: Db | null): Promise<string[]> {
    if (!db || articles.length === 0) {
      return [];
    }

    try {
      // Get the date range for context (last 7 days)
      const oldestArticle = articles.reduce(
        (oldest, article) => {
          if (!article.pubDate) return oldest;
          return !oldest || article.pubDate < oldest ? article.pubDate : oldest;
        },
        null as Date | null
      );

      if (!oldestArticle) {
        return [];
      }

      const contextStartDate = subDays(oldestArticle, 7);

      // Import schema tables
      const { dailySummaries } = await import('../../db.js');

      // Find related daily summaries
      const relatedSummaries = await db
        .select({
          id: dailySummaries.id,
          summaryContent: dailySummaries.summaryContent,
          summaryDate: dailySummaries.summaryDate,
        })
        .from(dailySummaries)
        .where(
          and(
            gte(dailySummaries.summaryDate, contextStartDate),
            lt(dailySummaries.summaryDate, oldestArticle)
          )
        )
        .orderBy(desc(dailySummaries.summaryDate))
        .limit(5);

      return relatedSummaries.map(
        (summary) =>
          `## Previous Summary (${format(summary.summaryDate, 'MMM d, yyyy')})\n${summary.summaryContent}`
      );
    } catch (error) {
      this.logger.warn('Failed to get related context', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Generate a weekly recap from daily summaries
   */
  async generateWeeklyRecap(
    summaries: DailySummary[],
    dateRange: { start: Date; end: Date },
    env: Env,
    promptName = 'weekly-beef-recap'
  ): Promise<string> {
    try {
      this.logger.info('Generating weekly recap', {
        startDate: format(dateRange.start, 'yyyy-MM-dd'),
        endDate: format(dateRange.end, 'yyyy-MM-dd'),
        summaryCount: summaries.length,
      });

      if (summaries.length === 0) {
        return '# No Summaries\n\nNo daily summaries were found for this week.';
      }

      // Count stories and sources
      let storyCount = 0;
      const sources = new Set<string>();

      // If summaries have additional metadata, use it
      summaries.forEach((summary: DailySummary & { articleCount?: number; feedName?: string }) => {
        // Count articles if available
        if (summary.articleCount) {
          storyCount += summary.articleCount;
        }
        // Track feed names if available
        if (summary.feedName) {
          sources.add(summary.feedName);
        }
      });

      // If we couldn't get exact counts, estimate based on summaries
      if (storyCount === 0) {
        // Estimate ~5-10 articles per daily summary
        storyCount = summaries.length * 7;
      }

      // Build context for template with content length limits to prevent timeouts
      const MAX_DAILY_SUMMARY_LENGTH = 5000; // Limit each daily summary to 5000 chars
      const templateContext = {
        weekStartDate: format(dateRange.start, 'yyyy-MM-dd'),
        weekEndDate: format(dateRange.end, 'yyyy-MM-dd'),
        displayDateRange: `${format(dateRange.start, 'MMM d')} - ${format(dateRange.end, 'MMM d, yyyy')}`,
        summaries: summaries.map((summary) => ({
          date: format(summary.summaryDate, 'yyyy-MM-dd'),
          displayDate: format(summary.summaryDate, 'EEEE, MMMM d'),
          content:
            summary.summaryContent.length > MAX_DAILY_SUMMARY_LENGTH
              ? `${summary.summaryContent.substring(
                  0,
                  MAX_DAILY_SUMMARY_LENGTH
                )}...\n\n[Content truncated for processing efficiency]`
              : summary.summaryContent,
        })),
        summaryCount: summaries.length,
        storyCount,
        sourceCount: sources.size || summaries.length, // At least one source per summary
      };

      // Render the prompt (use weekly-digest prompt)
      const prompt = renderPrompt(getPrompt('weekly-digest'), templateContext);

      // Log prompt size for debugging and apply final size limit
      const promptLength = prompt.length;
      const MAX_TOTAL_PROMPT_LENGTH = 200000; // 200k chars to prevent timeouts

      let response;

      if (promptLength > MAX_TOTAL_PROMPT_LENGTH) {
        this.logger.warn('Weekly summary prompt too large, truncating', {
          originalLength: promptLength,
          maxLength: MAX_TOTAL_PROMPT_LENGTH,
          weekStartDate: templateContext.weekStartDate,
          weekEndDate: templateContext.weekEndDate,
          summaryCount: templateContext.summaryCount,
        });

        // Truncate the prompt if it's still too large
        const truncatedPrompt = `${prompt.substring(
          0,
          MAX_TOTAL_PROMPT_LENGTH
        )}\n\n[Prompt truncated to prevent timeout - proceeding with available content]`;

        // Generate recap with AI using truncated prompt
        response = await this.geminiClient.generateWithRetry(truncatedPrompt, {
          config: {
            model: DEFAULT_MODELS.WEEKLY_SUMMARY,
            temperature: 0.8,
            maxOutputTokens: 65536, // 64K tokens for comprehensive weekly summaries
          },
          maxRetries: 3,
          onRetry: (attempt, error) => {
            this.logger.warn(`Retrying weekly recap generation (attempt ${attempt})`, {
              error: error.message,
            });
          },
        });
      } else {
        this.logger.info('Weekly summary prompt within size limits', {
          promptLength,
          maxLength: MAX_TOTAL_PROMPT_LENGTH,
          weekStartDate: templateContext.weekStartDate,
          weekEndDate: templateContext.weekEndDate,
        });

        // Generate recap with AI - weekly summaries need much higher token limits
        // Use retry logic for better reliability with large prompts
        response = await this.geminiClient.generateWithRetry(prompt, {
          config: {
            model: DEFAULT_MODELS.WEEKLY_SUMMARY,
            temperature: 0.8,
            maxOutputTokens: 65536, // 64K tokens for comprehensive weekly summaries
          },
          maxRetries: 3,
          onRetry: (attempt, error) => {
            this.logger.warn(`Retrying weekly recap generation (attempt ${attempt})`, {
              error: error.message,
            });
          },
        });
      }

      const recap = this.formatMarkdown(response.text);

      this.logger.info('Weekly recap generated successfully', {
        weekRange: `${format(dateRange.start, 'yyyy-MM-dd')} to ${format(dateRange.end, 'yyyy-MM-dd')}`,
        recapLength: recap.length,
      });

      return recap;
    } catch (error) {
      this.logger.error('Failed to generate weekly recap', error as Error);

      throw new ApiError('Failed to generate weekly recap', ErrorCode.SUMMARIZATION_ERROR, 500, {
        service: 'summarization',
        operation: 'generateWeeklyRecap',
        metadata: {
          startDate: dateRange.start.toISOString(),
          endDate: dateRange.end.toISOString(),
        },
      });
    }
  }

  /**
   * Extract topics from content using AI
   */
  async extractTopics(content: string, env: Env, promptName?: string): Promise<string[]> {
    try {
      this.logger.debug('Extracting topics from content', {
        contentLength: content.length,
        promptName: promptName || 'topic-extraction',
      });

      const templateContext = {
        weeklyRecap: content.substring(0, 5000), // Limit content length
      };

      // Render the prompt (use topic-extraction prompt)
      const prompt = renderPrompt(getPrompt('topic-extraction'), templateContext);

      // Extract topics with AI (expecting JSON response)
      const topics = await this.geminiClient.generateJSON<{ topics: string[] }>(prompt, {
        model: DEFAULT_MODELS.TOPIC_EXTRACTION,
        temperature: 0.5,
        maxOutputTokens: 4096,
      });

      const extractedTopics = topics.topics || [];

      this.logger.info('Topics extracted successfully', {
        topicCount: extractedTopics.length,
      });

      return extractedTopics;
    } catch (error) {
      this.logger.error('Failed to extract topics', error as Error);
      // Return empty array on failure to not break the flow
      return [];
    }
  }

  /**
   * Generate a title for the weekly recap
   */
  async generateTitle(
    content: string,
    topics: string[],
    env: Env,
    promptName?: string
  ): Promise<string> {
    try {
      this.logger.debug('Generating title for weekly recap', {
        topicCount: topics.length,
        promptName: promptName || 'beef-title-generator',
      });

      const templateContext = {
        weeklyRecap: content, // Send full content - model has 1M+ token limit
        topics, // Send all topics
      };

      // Render the prompt (use title-generator prompt)
      const prompt = renderPrompt(getPrompt('title-generator'), templateContext);

      // Generate title with AI - use retry logic for reliability
      const response = await this.geminiClient.generateWithRetry(prompt, {
        config: {
          model: DEFAULT_MODELS.BEEF_TITLE,
          temperature: 0.9,
          maxOutputTokens: 4096, // Much higher token limit for creative titles
        },
        maxRetries: 3,
        onRetry: (attempt, error) => {
          this.logger.warn(`Retrying title generation (attempt ${attempt})`, {
            error: error.message,
          });
        },
      });

      const title = response.text.trim().replace(/^#\s*/, ''); // Remove leading # if present

      this.logger.info('Title generated successfully', {
        titleLength: title.length,
      });

      return title;
    } catch (error) {
      this.logger.error('Failed to generate title', error as Error, {
        errorMessage: error instanceof Error ? error.message : String(error),
        topicCount: topics.length,
        contentLength: content.length,
      });
      // Return a default title on failure
      return 'Weekly Recap';
    }
  }

  /**
   * Parse weekly recap content into sections
   */
  parseRecapSections(content: string): {
    belowTheFoldContent?: string;
    recapContent: string;
    soWhatContent?: string;
  } {
    // Look for specific section markers
    const belowTheFoldMatch = content.match(/## Below the Fold\n([\s\S]*?)(?=## |$)/);
    const soWhatMatch = content.match(/## So What\?\n([\s\S]*?)(?=## |$)/);

    // Extract sections
    const belowTheFoldContent = belowTheFoldMatch?.[1]?.trim();
    const soWhatContent = soWhatMatch?.[1]?.trim();

    // Remove these sections from the main content
    let recapContent = content;
    if (belowTheFoldMatch) {
      recapContent = recapContent.replace(belowTheFoldMatch[0], '');
    }
    if (soWhatMatch) {
      recapContent = recapContent.replace(soWhatMatch[0], '');
    }

    // Return only non-empty sections
    return {
      recapContent: recapContent.trim(),
      ...(belowTheFoldContent && { belowTheFoldContent }),
      ...(soWhatContent && { soWhatContent }),
    };
  }

  /**
   * Save a weekly summary to the database
   */
  async saveWeeklySummary(
    summary: Omit<WeeklySummary, 'id' | 'createdAt' | 'updatedAt'>,
    dailySummaryIds: string[],
    db: Db
  ): Promise<WeeklySummary> {
    try {
      // Import schema tables
      const { weeklySummaries, dailyWeeklySummaryRelations } = await import('../../db.js');

      // Insert the summary
      const [savedSummary] = await db
        .insert(weeklySummaries)
        .values({
          weekStartDate: summary.weekStartDate,
          weekEndDate: summary.weekEndDate,
          feedGroupId: summary.feedGroupId,
          title: summary.title,
          recapContent: summary.recapContent,
          belowTheFoldContent: summary.belowTheFoldContent,
          soWhatContent: summary.soWhatContent,
          topics: summary.topics ? JSON.stringify(summary.topics) : null,
          sentToLexPage: summary.sentToLexPage || false,
          lexPageDocumentId: summary.lexPageDocumentId,
        })
        .returning();

      // Create daily-weekly relations in batches to avoid parameter limits
      if (dailySummaryIds.length > 0) {
        const BATCH_SIZE = 20; // D1 has limits on number of parameters
        for (let i = 0; i < dailySummaryIds.length; i += BATCH_SIZE) {
          const batch = dailySummaryIds.slice(i, i + BATCH_SIZE);
          await db.insert(dailyWeeklySummaryRelations).values(
            batch.map((dailySummaryId) => ({
              dailySummaryId,
              weeklySummaryId: savedSummary.id,
            }))
          );
        }
      }

      this.logger.info('Weekly summary saved', {
        summaryId: savedSummary.id,
        weekStartDate: summary.weekStartDate,
        weekEndDate: summary.weekEndDate,
        dailySummaryCount: dailySummaryIds.length,
      });

      return savedSummary;
    } catch (error) {
      this.logger.error('Failed to save weekly summary', error as Error, {
        weekStartDate: summary.weekStartDate,
        weekEndDate: summary.weekEndDate,
        error,
      });

      // Check if this is a unique constraint violation
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorCause = (error as { cause?: { message?: string } })?.cause?.message || '';

      if (
        errorMessage.includes('UNIQUE constraint failed') ||
        errorCause.includes('UNIQUE constraint failed') ||
        errorMessage.includes('WeeklySummary_weekStartDate_weekEndDate_key')
      ) {
        const startDateStr = format(summary.weekStartDate, 'yyyy-MM-dd');
        const endDateStr = format(summary.weekEndDate, 'yyyy-MM-dd');

        throw new DatabaseError(
          `Weekly summary already exists for ${startDateStr} to ${endDateStr}. Use 'force' option to regenerate.`,
          ErrorCode.DUPLICATE_ENTRY,
          {
            service: 'summarization',
            operation: 'saveWeeklySummary',
            metadata: {
              weekStartDate: startDateStr,
              weekEndDate: endDateStr,
              suggestion: 'Use force=true to regenerate or choose a different week',
            },
          }
        );
      }

      throw new DatabaseError('Failed to save weekly summary', ErrorCode.DATABASE_ERROR, {
        service: 'summarization',
        operation: 'saveWeeklySummary',
        metadata: {
          weekStartDate: summary.weekStartDate,
          weekEndDate: summary.weekEndDate,
          originalError: errorMessage,
        },
      });
    }
  }

  /**
   * Build structured prompt for AI generation
   */
  private async buildStructuredPrompt(
    articles: Article[],
    feedName: string,
    date: Date,
    relatedContext: string[]
  ): Promise<string> {
    // Build article context
    const articleContext = articles
      .map((article, index) => {
        const content = article.content || article.contentSnippet || '';
        const truncatedContent =
          content.length > 2000 ? `${content.substring(0, 1997)}...` : content;

        return `Article ${index + 1}: ${article.title}
Source: ${article.link || 'No URL'}
Published: ${article.pubDate ? format(article.pubDate, 'PPpp') : 'Unknown'}
Content: ${truncatedContent}`;
      })
      .join('\n\n');

    const contextSummary =
      relatedContext.length > 0
        ? `\n\nRelated Context from Recent Summaries:\n${relatedContext.join('\n\n')}`
        : '';

    return `Generate a comprehensive structured analysis of today's ${feedName} articles for ${format(date, 'EEEE, MMMM d, yyyy')}.

${articleContext}${contextSummary}

Please analyze these articles and provide a structured response with the following:

1. **Headline**: One compelling, specific line (max 120 chars) that captures the day's main theme
2. **Summary**: 2-3 informative paragraphs covering all major stories with key details
3. **Key Points**: 3-7 most important takeaways as clear, actionable bullet points
4. **Sentiment Analysis**: Overall mood of the news (-1 to 1 scale) with breakdown
5. **Topics**: Main themes with relevance scores and related keywords
6. **Entities**: Key people, companies, technologies mentioned with context
7. **Quotes**: Up to 3 most impactful quotes with sources

Focus on:
- Accuracy and factual precision
- Clear, professional language
- Actionable insights for readers
- Connections between stories
- Proper attribution of quotes and claims

Return your response as valid JSON matching the required schema. Do not include markdown formatting or code blocks.`;
  }

  /**
   * Create empty structured summary for cases with no articles
   */
  private createEmptyStructuredSummary(
    feedName: string,
    date: Date,
    startTime: number
  ): StructuredDailySummary {
    const dateStr = format(date, 'yyyy-MM-dd');
    const displayDate = format(date, 'EEEE, MMMM d, yyyy');
    const markdown = `# No Articles - ${displayDate}\n\nNo articles were found for ${feedName} on this date.`;

    return {
      version: '1.0',
      metadata: {
        date: dateStr,
        feedId: 'unknown',
        feedName,
        articleCount: 0,
        generatedAt: new Date().toISOString(),
        processingTime: Date.now() - startTime,
      },
      content: {
        headline: `No ${feedName} articles found`,
        summary: `No articles were available for ${feedName} on ${displayDate}.`,
        keyPoints: ['No articles to summarize'],
      },
      insights: {
        sentiment: { overall: 'neutral', score: 0 },
        topics: [],
        entities: [],
        quotes: [],
      },
      articles: [],
      formatting: { markdown },
    };
  }

  /**
   * Assemble complete structured summary from AI-generated content
   */
  private assembleStructuredSummary(
    generated: GeneratedStructuredContent,
    articles: Article[],
    feedName: string,
    date: Date,
    startTime: number
  ): StructuredDailySummary {
    const dateStr = format(date, 'yyyy-MM-dd');

    // Create article references
    const articleRefs = articles.map(
      (article, index) =>
        ({
          id: article.id || `article-${index + 1}`,
          title: article.title || 'Untitled',
          url: article.link || '#',
          contribution: index < 2 ? 'primary' : index < 5 ? 'supporting' : 'minor',
        }) as const
    );

    // Build structured summary
    const structuredSummary: StructuredDailySummary = {
      version: '1.0',
      metadata: {
        date: dateStr,
        feedId: 'unknown', // Will be set by caller
        feedName,
        articleCount: articles.length,
        generatedAt: new Date().toISOString(),
        processingTime: Date.now() - startTime,
      },
      content: {
        headline: generated.headline || `${feedName} Daily Update`,
        summary: generated.summary || 'No summary available',
        keyPoints: generated.keyPoints?.length ? generated.keyPoints : ['No key points available'],
      },
      insights: {
        sentiment: generated.sentiment || { overall: 'neutral', score: 0 },
        topics: generated.topics || [],
        entities: generated.entities || [],
        quotes: generated.quotes || [],
      },
      articles: articleRefs,
      formatting: {
        markdown: '', // Will be generated below
      },
    };

    // Generate markdown representation
    structuredSummary.formatting.markdown = SummaryAdapter.toMarkdown(structuredSummary);

    return structuredSummary;
  }

  /**
   * Save structured daily summary with both formats
   */
  async saveStructuredDailySummary(
    structuredSummary: StructuredDailySummary,
    feedId: string,
    articleIds: string[],
    db: Db
  ): Promise<DailySummary> {
    try {
      // Update metadata with correct feedId
      structuredSummary.metadata.feedId = feedId;

      // Prepare denormalized fields for search
      const topicsList = structuredSummary.insights.topics.map((t) => t.name).join(', ');

      const entityList = structuredSummary.insights.entities.map((e) => e.name).join(', ');

      // Import schema tables
      const { dailySummaries, articleSummaryRelations } = await import('../../db.js');

      // Insert the summary with both structured and markdown formats
      const [savedSummary] = await db
        .insert(dailySummaries)
        .values({
          feedId,
          summaryDate: parseISO(structuredSummary.metadata.date),
          summaryContent: structuredSummary.formatting.markdown, // Backward compatibility
          structuredContent: JSON.stringify(structuredSummary), // New structured format
          schemaVersion: structuredSummary.version,
          sentiment: structuredSummary.insights.sentiment.score,
          topicsList: topicsList || null,
          entityList: entityList || null,
          articleCount: structuredSummary.metadata.articleCount,
        })
        .returning();

      // Create article-summary relations
      if (articleIds.length > 0) {
        await db.insert(articleSummaryRelations).values(
          articleIds.map((articleId) => ({
            articleId,
            dailySummaryId: savedSummary.id,
          }))
        );
      }

      this.logger.info('Structured daily summary saved', {
        summaryId: savedSummary.id,
        summaryDate: structuredSummary.metadata.date,
        articleCount: articleIds.length,
        topicCount: structuredSummary.insights.topics.length,
        entityCount: structuredSummary.insights.entities.length,
      });

      return savedSummary;
    } catch (error) {
      this.logger.error('Failed to save structured daily summary', error as Error, {
        feedId,
        summaryDate: structuredSummary.metadata.date,
        error,
      });

      throw new DatabaseError('Failed to save structured daily summary', ErrorCode.DATABASE_ERROR, {
        service: 'summarization',
        operation: 'saveStructuredDailySummary',
        metadata: {
          feedId,
          summaryDate: structuredSummary.metadata.date,
          originalError: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  /**
   * Format markdown content
   */
  private formatMarkdown(content: string): string {
    // Clean up common AI response artifacts
    return content
      .trim()
      .replace(/```markdown\n?/g, '') // Remove markdown code blocks
      .replace(/```\n?$/g, '') // Remove closing code blocks
      .replace(/\n{3,}/g, '\n\n') // Normalize line breaks
      .trim();
  }

  /**
   * Create a SummarizationService instance
   */
  static create(options: {
    geminiClient: IGeminiClient;
    logger?: ILogger;
  }): SummarizationService {
    return new SummarizationService(options);
  }
}
