import {
  Logger,
  SummarizationService,
  GeminiClient,
  ApiError,
  DatabaseError,
  ErrorCode,
} from "../../services/index.js";
import { getDb, setupDb } from "../../db.js";
import { toTimestamp } from "../../db/helpers.js";
import {
  validateQueueMessage,
  DailySummaryProcessorMessageSchema,
  type DailySummaryProcessorMessage,
} from "../utils/queue-dispatcher.js";

/**
 * Daily summary processor queue consumer
 */
export async function queue(
  batch: MessageBatch<DailySummaryProcessorMessage>,
  env: Env,
): Promise<void> {
  const logger = Logger.forService("DailySummaryProcessor");

  logger.info("Processing daily summary processor batch", {
    messageCount: batch.messages.length,
    envKeys: Object.keys(env),
    hasAppConfigKV: !!env.BRIEFINGS_CONFIG_KV,
    appConfigKVType: env.BRIEFINGS_CONFIG_KV
      ? typeof env.BRIEFINGS_CONFIG_KV
      : "undefined",
  });

  await setupDb(env);

  for (const message of batch.messages) {
    try {
      await processDailySummaryProcessorMessage(message, env, logger);
      message.ack();
    } catch (error) {
      logger.error("Daily summary processor message failed", error as Error, {
        messageId: message.body.requestId,
        feedName: message.body.feedName,
        error:
          error instanceof Error
            ? { message: error.message, stack: error.stack, name: error.name }
            : String(error),
        err: error,
      });

      const shouldRetry = isRetryableError(error);
      if (!shouldRetry) {
        message.ack();
      }
    }
  }
}

async function processDailySummaryProcessorMessage(
  message: Message<DailySummaryProcessorMessage>,
  env: Env,
  logger: ReturnType<typeof Logger.forService>,
): Promise<void> {
  const startTime = Date.now();

  try {
    const validatedMessage = validateQueueMessage(
      message.body,
      DailySummaryProcessorMessageSchema,
    );

    logger.info("Processing daily summary processor message", {
      requestId: validatedMessage.requestId,
      date: validatedMessage.date,
      feedName: validatedMessage.feedName,
      articleCount: validatedMessage.articleIds.length,
      force: validatedMessage.force,
    });

    const db = getDb(env);

    // Check if summary already exists (unless force is true)
    if (!validatedMessage.force) {
      const summaryDate = new Date(validatedMessage.date);
      const summaryTs = toTimestamp(summaryDate)!;

      const feedInfo = await db
        .selectFrom("Feed")
        .selectAll()
        .where("name", "=", validatedMessage.feedName)
        .limit(1)
        .executeTakeFirst();

      if (feedInfo) {
        const existingSummary = await db
          .selectFrom("DailySummary")
          .selectAll()
          .where("feedId", "=", feedInfo.id)
          .where("summaryDate", "=", summaryTs)
          .limit(1)
          .executeTakeFirst();

        if (existingSummary) {
          logger.info("Daily summary already exists, skipping", {
            requestId: validatedMessage.requestId,
            date: validatedMessage.date,
            feedName: validatedMessage.feedName,
            existingSummaryId: existingSummary.id,
          });
          return;
        }
      }
    }

    // Fetch articles by IDs with feed join
    // Note: We explicitly select Feed columns to avoid id collision with Article
    const articlesWithFeeds = await db
      .selectFrom("Article")
      .innerJoin("Feed", "Article.feedId", "Feed.id")
      .selectAll("Article")
      .select([
        "Feed.id as feedTableId",
        "Feed.name as feedName",
        "Feed.url as feedUrl",
        "Feed.category as feedCategory",
        "Feed.isActive as feedIsActive",
        "Feed.isValid as feedIsValid",
        "Feed.validationError as feedValidationError",
        "Feed.lastFetchedAt as feedLastFetchedAt",
        "Feed.lastError as feedLastError",
        "Feed.errorCount as feedErrorCount",
        "Feed.createdAt as feedCreatedAt",
        "Feed.updatedAt as feedUpdatedAt",
      ])
      .where("Article.id", "in", validatedMessage.articleIds)
      .orderBy("Article.pubDate", "desc")
      .execute();

    if (articlesWithFeeds.length === 0) {
      logger.warn("No articles found for daily summary processing", {
        requestId: validatedMessage.requestId,
        articleIds: validatedMessage.articleIds,
      });
      return;
    }

    // Transform joined data
    const articleData = articlesWithFeeds.map((row) => ({
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
        id: row.feedTableId,
        name: row.feedName,
        url: row.feedUrl,
        category: row.feedCategory,
        isActive: row.feedIsActive,
        isValid: row.feedIsValid,
        validationError: row.feedValidationError,
        lastFetchedAt: row.feedLastFetchedAt,
        lastError: row.feedLastError,
        errorCount: row.feedErrorCount,
        createdAt: row.feedCreatedAt,
        updatedAt: row.feedUpdatedAt,
      },
    }));

    // Initialize services
    const geminiClient = new GeminiClient({
      apiKey: env.GEMINI_API_KEY,
    });

    const summarizationService = new SummarizationService({
      geminiClient,
      logger: logger.child({ component: "SummarizationService" }),
    });

    // Generate structured daily summary
    const summaryDate = new Date(validatedMessage.date);
    const structuredSummary = await summarizationService.generateStructuredDailySummary(
      articleData,
      validatedMessage.feedName,
      summaryDate,
      env,
      db,
    );

    // Get feedId from the first article
    const feedId = articlesWithFeeds[0].feedId;

    // Extract structured data for database
    const summaryContent = structuredSummary.formatting.markdown;
    const structuredContent = JSON.stringify(structuredSummary);
    const sentiment = structuredSummary.insights.sentiment.score;
    const topicsList = structuredSummary.insights.topics.map((t) => t.name).join(", ");
    const entityList = structuredSummary.insights.entities.map((e) => e.name).join(", ");

    // Save daily summary
    const savedSummary = await summarizationService.saveDailySummary(
      {
        feedId,
        summaryDate: toTimestamp(summaryDate)!,
        summaryContent,
        structuredContent,
        schemaVersion: "1.0",
        sentiment,
        topicsList: topicsList || null,
        entityList: entityList || null,
        articleCount: articlesWithFeeds.length,
      },
      validatedMessage.articleIds,
      db,
    );

    logger.info("Daily summary generated and saved", {
      requestId: validatedMessage.requestId,
      summaryId: savedSummary.id,
      feedName: validatedMessage.feedName,
      date: validatedMessage.date,
      articleCount: articleData.length,
      summaryLength: summaryContent.length,
    });

    const duration = Date.now() - startTime;

    logger.info("Daily summary processing completed", {
      requestId: validatedMessage.requestId,
      summaryId: savedSummary.id,
      feedName: validatedMessage.feedName,
      date: validatedMessage.date,
      duration,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    const messageData = message.body;

    if (
      error instanceof DatabaseError &&
      error.code === ErrorCode.DUPLICATE_ENTRY
    ) {
      logger.info("Duplicate daily summary found, skipping", {
        requestId: messageData.requestId,
        date: messageData.date,
        feedName: messageData.feedName,
        duration,
      });
      return;
    }

    logger.error("Daily summary processing failed", error as Error, {
      requestId: messageData.requestId,
      date: messageData.date,
      feedName: messageData.feedName,
      articleCount: messageData.articleIds.length,
      duration,
      error:
        error instanceof Error
          ? { message: error.message, stack: error.stack, name: error.name }
          : String(error),
      err: error,
    });

    throw error;
  }
}

function isRetryableError(error: unknown): boolean {
  if (
    error &&
    typeof error === "object" &&
    "name" in error &&
    error.name === "ValidationError"
  ) {
    return false;
  }

  if (error instanceof ApiError) {
    if (error.statusCode >= 400 && error.statusCode < 500) {
      return false;
    }
    return true;
  }

  if (error instanceof DatabaseError) {
    if (error.code === ErrorCode.DUPLICATE_ENTRY) {
      return false;
    }
    if (error.context?.operation === "constraint_violation") {
      return false;
    }
    return true;
  }

  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "SUMMARIZATION_ERROR"
  ) {
    return true;
  }

  const retryablePatterns = [
    /timeout/i,
    /network/i,
    /connection/i,
    /ECONNRESET/i,
    /ENOTFOUND/i,
    /ETIMEDOUT/i,
    /rate.?limit/i,
    /quota.?exceeded/i,
  ];

  const errorMessage = error instanceof Error ? error.message : String(error);
  return retryablePatterns.some((pattern) => pattern.test(errorMessage));
}

interface Message<T = unknown> {
  id: string;
  timestamp: Date;
  body: T;
  ack(): void;
  retry(): void;
}

interface MessageBatch<T = unknown> {
  queue: string;
  messages: Message<T>[];
}
