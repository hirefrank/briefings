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
import type { Db } from '../../db.js';
import type { Article, DailySummary, WeeklySummary, Feed, NewDailySummary, NewWeeklySummary } from '../../db/types.js';
import { toTimestamp, fromTimestamp } from '../../db/helpers.js';
import { Logger } from '../../lib/logger.js';
import { ApiError, DatabaseError, ErrorCode } from '../../lib/errors.js';
import { format, subDays, parseISO } from 'date-fns';
import { DEFAULT_MODELS } from '../../lib/constants.js';
import { renderPrompt, getPrompt } from '../../lib/prompts.js';

type ArticleWithFeed = Article & { feed?: Feed };

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
    articles: ArticleWithFeed[],
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
        return this.createEmptyStructuredSummary(feedName, date, startTime);
      }

      const MAX_ARTICLES_PER_SUMMARY = 10;
      const articlesToSummarize = articles.slice(0, MAX_ARTICLES_PER_SUMMARY);

      if (articles.length > MAX_ARTICLES_PER_SUMMARY) {
        this.logger.warn('Too many articles for single summary', {
          feedName,
          totalArticles: articles.length,
          summarizing: MAX_ARTICLES_PER_SUMMARY,
        });
      }

      const relatedContext = db ? await this.getRelatedContext(articles, db) : [];

      const prompt = await this.buildStructuredPrompt(
        articlesToSummarize,
        feedName,
        date,
        relatedContext
      );

      const generatedContent = await this.geminiClient.generateJSON<GeneratedStructuredContent>(
        prompt,
        {
          model: DEFAULT_MODELS.DAILY_SUMMARY,
          temperature: 0.7,
          maxOutputTokens: 16384,
        }
      );

      // Get feedId from first article
      const feedId = articlesToSummarize[0]?.feed?.id || 'unknown';

      const structuredSummary = this.assembleStructuredSummary(
        generatedContent,
        articlesToSummarize,
        feedId,
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
                ? { message: error.message, name: error.name, stack: error.stack }
                : String(error),
          },
        }
      );
    }
  }

  /**
   * Generate a daily summary for a set of articles
   */
  async generateDailySummary(
    articles: ArticleWithFeed[],
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

      const MAX_ARTICLES_PER_SUMMARY = 10;
      const articlesToSummarize = articles.slice(0, MAX_ARTICLES_PER_SUMMARY);

      if (articles.length > MAX_ARTICLES_PER_SUMMARY) {
        this.logger.warn('Too many articles for single summary', {
          feedName,
          totalArticles: articles.length,
          summarizing: MAX_ARTICLES_PER_SUMMARY,
        });
      }

      const relatedContext = db ? await this.getRelatedContext(articles, db) : [];

      const templateContext = {
        feedName,
        date: format(date, 'yyyy-MM-dd'),
        displayDate: format(date, 'EEEE, MMMM d, yyyy'),
        articles: articlesToSummarize.map((article, index) => {
          const content = article.content || article.contentSnippet || '';
          const MAX_ARTICLE_CONTENT_LENGTH = 2000;
          const truncatedContent =
            content.length > MAX_ARTICLE_CONTENT_LENGTH
              ? `${content.substring(0, MAX_ARTICLE_CONTENT_LENGTH - 3)}...`
              : content;

          const pubDateObj = fromTimestamp(article.pubDate);
          return {
            title: article.title,
            link: article.link,
            content: truncatedContent,
            contentSnippet: truncatedContent,
            creator: article.creator,
            pubDate: pubDateObj ? format(pubDateObj, 'PPpp') : null,
            articleNumber: index + 1,
          };
        }),
        articleCount: articlesToSummarize.length,
      };

      let prompt = renderPrompt(getPrompt('daily-summary'), templateContext);

      // Hardcode context injection - always append if available
      if (relatedContext.length > 0) {
        prompt += `\n\n---\n\nRelated Context from Recent Summaries (for continuity):\n\n${relatedContext.join('\n\n')}`;
      }

      let summary: string;
      try {
        const response = await this.geminiClient.generateContent(prompt, {
          model: DEFAULT_MODELS.DAILY_SUMMARY,
          temperature: 1.0,
          thinkingLevel: 'LOW',
          maxOutputTokens: 16384,
        });
        summary = this.formatMarkdown(response.text);
      } catch (error) {
        if (error instanceof Error && error.message.includes('No text content')) {
          this.logger.warn('AI returned empty response, using fallback summary', {
            feedName,
            articleCount: articlesToSummarize.length,
          });

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
                ? { message: error.message, name: error.name, stack: error.stack }
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
      const now = Date.now();
      const savedSummary = await db
        .insertInto('DailySummary')
        .values({
          id: crypto.randomUUID(),
          feedId: summary.feedId,
          summaryDate: summary.summaryDate,
          summaryContent: summary.summaryContent,
          structuredContent: summary.structuredContent || null,
          schemaVersion: summary.schemaVersion || null,
          sentiment: summary.sentiment ?? null,
          topicsList: summary.topicsList || null,
          entityList: summary.entityList || null,
          articleCount: summary.articleCount || null,
          createdAt: now,
          updatedAt: now,
        } satisfies NewDailySummary)
        .returningAll()
        .executeTakeFirstOrThrow();

      // Create article-summary relations
      if (articleIds.length > 0) {
        await db
          .insertInto('ArticleSummaryRelation')
          .values(
            articleIds.map((articleId) => ({
              articleId,
              dailySummaryId: savedSummary.id,
            }))
          )
          .execute();
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

      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorCause = (error as { cause?: { message?: string } })?.cause?.message || '';

      if (
        errorMessage.includes('UNIQUE constraint failed') ||
        errorCause.includes('UNIQUE constraint failed') ||
        errorMessage.includes('DailySummary_feedId_summaryDate_key')
      ) {
        const feed = await db
          .selectFrom('Feed')
          .select('name')
          .where('id', '=', summary.feedId)
          .executeTakeFirst();

        const feedName = feed?.name || 'Unknown Feed';
        const summaryDateObj = fromTimestamp(summary.summaryDate);
        const dateStr = summaryDateObj ? format(summaryDateObj, 'yyyy-MM-dd') : 'unknown';

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
  async getRelatedContext(articles: ArticleWithFeed[], db: Db | null): Promise<string[]> {
    if (!db || articles.length === 0) {
      return [];
    }

    try {
      const oldestArticle = articles.reduce(
        (oldest, article) => {
          if (!article.pubDate) return oldest;
          return !oldest || article.pubDate < oldest ? article.pubDate : oldest;
        },
        null as number | null
      );

      if (!oldestArticle) {
        return [];
      }

      const oldestDate = fromTimestamp(oldestArticle);
      if (!oldestDate) return [];

      const contextStartDate = subDays(oldestDate, 7);
      const contextStartTs = toTimestamp(contextStartDate)!;

      const relatedSummaries = await db
        .selectFrom('DailySummary')
        .select(['id', 'summaryContent', 'summaryDate'])
        .where('summaryDate', '>=', contextStartTs)
        .where('summaryDate', '<', oldestArticle)
        .orderBy('summaryDate', 'desc')
        .limit(5)
        .execute();

      return relatedSummaries.map((summary) => {
        const dateObj = fromTimestamp(summary.summaryDate);
        const dateStr = dateObj ? format(dateObj, 'MMM d, yyyy') : 'Unknown';
        return `## Previous Summary (${dateStr})\n${summary.summaryContent}`;
      });
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
    previousContext?: string
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

      let storyCount = 0;
      const sources = new Set<string>();

      summaries.forEach((summary: DailySummary & { articleCount?: number; feedName?: string }) => {
        if (summary.articleCount) {
          storyCount += summary.articleCount;
        }
        if (summary.feedName) {
          sources.add(summary.feedName);
        }
      });

      if (storyCount === 0) {
        storyCount = summaries.length * 7;
      }

      const MAX_DAILY_SUMMARY_LENGTH = 5000;
      const templateContext = {
        weekStartDate: format(dateRange.start, 'yyyy-MM-dd'),
        weekEndDate: format(dateRange.end, 'yyyy-MM-dd'),
        displayDateRange: `${format(dateRange.start, 'MMM d')} - ${format(dateRange.end, 'MMM d, yyyy')}`,
        summaries: summaries.map((summary) => {
          const dateObj = fromTimestamp(summary.summaryDate);
          return {
            date: dateObj ? format(dateObj, 'yyyy-MM-dd') : 'unknown',
            displayDate: dateObj ? format(dateObj, 'EEEE, MMMM d') : 'Unknown',
            content:
              summary.summaryContent.length > MAX_DAILY_SUMMARY_LENGTH
                ? `${summary.summaryContent.substring(
                    0,
                    MAX_DAILY_SUMMARY_LENGTH
                  )}...\n\n[Content truncated for processing efficiency]`
                : summary.summaryContent,
          };
        }),
        summaryCount: summaries.length,
        storyCount,
        sourceCount: sources.size || summaries.length,
      };

      let prompt = renderPrompt(getPrompt('weekly-digest'), templateContext);

      // Hardcode context injection - always append if available
      if (previousContext && previousContext.length > 0) {
        prompt += `\n\n---\n\nPrevious Weeks' Context (avoid repetition, find fresh angles):\n\n${previousContext}`;
      }

      const promptLength = prompt.length;
      const MAX_TOTAL_PROMPT_LENGTH = 200000;

      let response;

      if (promptLength > MAX_TOTAL_PROMPT_LENGTH) {
        this.logger.warn('Weekly summary prompt too large, truncating', {
          originalLength: promptLength,
          maxLength: MAX_TOTAL_PROMPT_LENGTH,
          weekStartDate: templateContext.weekStartDate,
          weekEndDate: templateContext.weekEndDate,
          summaryCount: templateContext.summaryCount,
        });

        const truncatedPrompt = `${prompt.substring(
          0,
          MAX_TOTAL_PROMPT_LENGTH
        )}\n\n[Prompt truncated to prevent timeout - proceeding with available content]`;

        response = await this.geminiClient.generateWithRetry(truncatedPrompt, {
          config: {
            model: DEFAULT_MODELS.WEEKLY_SUMMARY,
            temperature: 1.0,
            thinkingLevel: 'HIGH',
            maxOutputTokens: 65536,
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

        response = await this.geminiClient.generateWithRetry(prompt, {
          config: {
            model: DEFAULT_MODELS.WEEKLY_SUMMARY,
            temperature: 1.0,
            thinkingLevel: 'HIGH',
            maxOutputTokens: 65536,
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
   * Parse digest metadata from the start of the content
   * Expects format:
   *   Title: 🥩 Event 1, Event 2, Event 3
   *   Topics: Topic 1, Topic 2, Topic 3, Topic 4
   *   Subject: Thematic Subhead
   *   [blank line]
   *   [rest of content]
   */
  parseDigestMetadata(content: string): { title: string; topics: string[]; signOff: string; cleanContent: string } {
    const lines = content.split('\n');
    let title = 'Weekly Briefing';
    let topics: string[] = [];
    let signOff = '';
    let endIndex = 0;

    for (let i = 0; i < Math.min(lines.length, 15); i++) {
      const line = lines[i].trim();
      if (line.startsWith('Title:')) {
        title = line.replace('Title:', '').trim();
      } else if (line.startsWith('Topics:')) {
        topics = line.replace('Topics:', '').split(',').map(t => t.trim()).filter(t => t);
      } else if (line.startsWith('Subject:')) {
        // Subject line is optional metadata, don't parse it separately
      } else if (line.startsWith('Sign-off:')) {
        signOff = line.replace('Sign-off:', '').trim();
      }

      if (line === '' && i > 0) {
        endIndex = i + 1;
        break;
      }
    }

    this.logger.info('Parsed digest metadata', {
      title,
      topicCount: topics.length,
      hasSignOff: !!signOff,
      contentLength: content.length,
    });

    return { title, topics, signOff, cleanContent: lines.slice(endIndex).join('\n').trim() };
  }

  /**
   * Parse weekly recap content into sections
   */
  parseRecapSections(content: string): {
    belowTheFoldContent?: string;
    recapContent: string;
    soWhatContent?: string;
  } {
    const belowTheFoldMatch = content.match(/## Below the Fold\n([\s\S]*?)(?=## |$)/);
    const soWhatMatch = content.match(/## So What\?\n([\s\S]*?)(?=## |$)/);

    const belowTheFoldContent = belowTheFoldMatch?.[1]?.trim();
    const soWhatContent = soWhatMatch?.[1]?.trim();

    let recapContent = content;
    if (belowTheFoldMatch) {
      recapContent = recapContent.replace(belowTheFoldMatch[0], '');
    }
    if (soWhatMatch) {
      recapContent = recapContent.replace(soWhatMatch[0], '');
    }

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
      const now = Date.now();
      const savedSummary = await db
        .insertInto('WeeklySummary')
        .values({
          id: crypto.randomUUID(),
          weekStartDate: summary.weekStartDate,
          weekEndDate: summary.weekEndDate,
          title: summary.title,
          recapContent: summary.recapContent,
          belowTheFoldContent: summary.belowTheFoldContent || null,
          soWhatContent: summary.soWhatContent || null,
          topics: summary.topics ? (typeof summary.topics === 'string' ? summary.topics : JSON.stringify(summary.topics)) : null,
          sentAt: summary.sentAt || null,
          createdAt: now,
          updatedAt: now,
        } satisfies NewWeeklySummary)
        .returningAll()
        .executeTakeFirstOrThrow();

      // Create daily-weekly relations in batches
      if (dailySummaryIds.length > 0) {
        const BATCH_SIZE = 20;
        for (let i = 0; i < dailySummaryIds.length; i += BATCH_SIZE) {
          const batch = dailySummaryIds.slice(i, i + BATCH_SIZE);
          await db
            .insertInto('DailyWeeklySummaryRelation')
            .values(
              batch.map((dailySummaryId) => ({
                dailySummaryId,
                weeklySummaryId: savedSummary.id,
              }))
            )
            .execute();
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

      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorCause = (error as { cause?: { message?: string } })?.cause?.message || '';

      if (
        errorMessage.includes('UNIQUE constraint failed') ||
        errorCause.includes('UNIQUE constraint failed') ||
        errorMessage.includes('WeeklySummary_weekStartDate_weekEndDate_key')
      ) {
        const startDateObj = fromTimestamp(summary.weekStartDate);
        const endDateObj = fromTimestamp(summary.weekEndDate);
        const startDateStr = startDateObj ? format(startDateObj, 'yyyy-MM-dd') : 'unknown';
        const endDateStr = endDateObj ? format(endDateObj, 'yyyy-MM-dd') : 'unknown';

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
    articles: ArticleWithFeed[],
    feedName: string,
    date: Date,
    relatedContext: string[]
  ): Promise<string> {
    const articleContext = articles
      .map((article, index) => {
        const content = article.content || article.contentSnippet || '';
        const truncatedContent =
          content.length > 2000 ? `${content.substring(0, 1997)}...` : content;

        const pubDateObj = fromTimestamp(article.pubDate);
        return `Article ${index + 1}: ${article.title}
Source: ${article.link || 'No URL'}
Published: ${pubDateObj ? format(pubDateObj, 'PPpp') : 'Unknown'}
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
4. **Sentiment Analysis**: Overall mood of the news (-1 to 1 scale) with breakdown. BE BOLD: Most tech news is neutral (0), but look for positive stories (0.3 to 0.8) about breakthroughs, launches, or human triumphs, and negative stories (-0.3 to -0.8) about failures, layoffs, security breaches, or harmful tech. Avoid defaulting to 0 unless the news truly is neutral. Provide specific breakdown of positive/neutral/negative elements.
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
    articles: ArticleWithFeed[],
    feedId: string,
    feedName: string,
    date: Date,
    startTime: number
  ): StructuredDailySummary {
    const dateStr = format(date, 'yyyy-MM-dd');

    const articleRefs = articles.map(
      (article, index) =>
        ({
          id: article.id || `article-${index + 1}`,
          title: article.title || 'Untitled',
          url: article.link || '#',
          contribution: index < 2 ? 'primary' : index < 5 ? 'supporting' : 'minor',
        }) as const
    );

    // Normalize topics - handle both 'name' and 'theme' fields
    const normalizedTopics = (generated.topics || []).map((topic) => ({
      name: topic.name || (topic as { theme?: string }).theme || 'Unknown Topic',
      relevance: topic.relevance ?? 0.5,
      keywords: topic.keywords || [],
    }));

    const structuredSummary: StructuredDailySummary = {
      version: '1.0',
      metadata: {
        date: dateStr,
        feedId,
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
        topics: normalizedTopics,
        entities: generated.entities || [],
        quotes: generated.quotes || [],
      },
      articles: articleRefs,
      formatting: {
        markdown: '',
      },
    };

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
      structuredSummary.metadata.feedId = feedId;

      const topicsList = structuredSummary.insights.topics.map((t) => t.name).join(', ');
      const entityList = structuredSummary.insights.entities.map((e) => e.name).join(', ');

      const now = Date.now();
      const savedSummary = await db
        .insertInto('DailySummary')
        .values({
          id: crypto.randomUUID(),
          feedId,
          summaryDate: toTimestamp(parseISO(structuredSummary.metadata.date))!,
          summaryContent: structuredSummary.formatting.markdown,
          structuredContent: JSON.stringify(structuredSummary),
          schemaVersion: structuredSummary.version,
          sentiment: structuredSummary.insights.sentiment.score,
          topicsList: topicsList || null,
          entityList: entityList || null,
          articleCount: structuredSummary.metadata.articleCount,
          createdAt: now,
          updatedAt: now,
        } satisfies NewDailySummary)
        .returningAll()
        .executeTakeFirstOrThrow();

      if (articleIds.length > 0) {
        await db
          .insertInto('ArticleSummaryRelation')
          .values(
            articleIds.map((articleId) => ({
              articleId,
              dailySummaryId: savedSummary.id,
            }))
          )
          .execute();
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
    return content
      .trim()
      .replace(/```markdown\n?/g, '')
      .replace(/```\n?$/g, '')
      .replace(/\n{3,}/g, '\n\n')
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
