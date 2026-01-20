// Env type is globally defined
import { Logger } from '../../services/index.js';
import { QueueDispatcher } from '../utils/queue-dispatcher.js';
import {
  parseRequestBody,
  createSuccessResponse,
  createErrorResponse,
  createValidationErrorResponse,
  DailySummaryRequestSchema,
  ValidationError,
  validateAndParseDate,
} from './schemas.js';

/**
 * Initiate daily summary generation task
 * POST /run/daily-summary
 *
 * Body (JSON):
 * - date (optional): Date to generate summary for (YYYY-MM-DD format). Defaults to yesterday.
 * - feedName (optional): Generate summary for specific feed only
 * - force (optional): Force regeneration even if summary already exists
 */
export async function POST(request: Request, env: Env): Promise<Response> {
  const logger = Logger.forService('DailySummaryEndpoint');

  try {
    logger.info('Daily summary request received');

    // Parse and validate request body
    const body = await parseRequestBody(request, DailySummaryRequestSchema);

    // Validate and parse date (defaults to yesterday)
    const targetDate = body.date ? validateAndParseDate(body.date, false) : getYesterday();

    // Validate date is not in the future
    const today = new Date().toISOString().split('T')[0];
    if (targetDate > today) {
      logger.warn('Daily summary requested for future date', { targetDate });
      return createErrorResponse('Cannot generate summary for future dates', 400, 'INVALID_DATE', {
        targetDate,
        today,
      });
    }

    // Initialize queue dispatcher
    const queueDispatcher = QueueDispatcher.create(env);

    // Send daily summary task to queue
    const requestId = await queueDispatcher.sendToDailySummaryQueue(
      targetDate,
      body.feedName,
      body.force
    );

    const message = body.feedName
      ? `Daily summary task initiated for ${body.feedName} on ${targetDate}`
      : `Daily summary task initiated for ${targetDate}`;

    logger.info('Daily summary task initiated', {
      date: targetDate,
      feedName: body.feedName,
      requestId,
      force: body.force,
    });

    return createSuccessResponse(message, {
      requestId,
      date: targetDate,
      feedName: body.feedName,
      force: body.force,
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      logger.warn('Daily summary request validation failed', {
        error: error.message,
        errors: error.errors,
      });
      return createValidationErrorResponse(error);
    }

    logger.error('Daily summary request failed', error as Error);

    return createErrorResponse('Internal server error', 500, 'INTERNAL_ERROR', {
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Get yesterday's date in YYYY-MM-DD format
 */
function getYesterday(): string {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return yesterday.toISOString().split('T')[0];
}

/**
 * GET method for checking status or getting information
 */
export async function GET(
  request: Request,
  env: Env,
  ctx?: { authenticated?: boolean }
): Promise<Response> {
  const logger = Logger.forService('DailySummaryEndpoint');

  // Check if authenticated (set by checkApiKey middleware)
  const authenticated = ctx?.authenticated || false;

  if (!authenticated) {
    return createErrorResponse(
      'Authentication required. Please provide X-API-Key header.',
      401,
      'AUTHENTICATION_REQUIRED'
    );
  }

  try {
    const url = new URL(request.url);
    const date = url.searchParams.get('date');
    const feedName = url.searchParams.get('feedName');

    // Parse query parameters using the same schema
    const params = {
      date: date || undefined,
      feedName: feedName || undefined,
    };

    const validatedParams = DailySummaryRequestSchema.parse(params);

    const targetDate = validatedParams.date
      ? validateAndParseDate(validatedParams.date, false)
      : getYesterday();

    // Return API documentation with examples
    return new Response(
      JSON.stringify(
        {
          endpoint: '/run/daily-summary',
          method: 'POST',
          description: 'Trigger daily summary generation',
          headers: {
            'X-API-Key': 'Required - Your API key',
            'Content-Type': 'application/json (for POST body)',
          },
          body: {
            date: '(optional) Date in YYYY-MM-DD format. Defaults to yesterday.',
            feedName:
              '(optional) Specific feed name to summarize. If not provided, all feeds are summarized.',
            force: '(optional) Force regeneration even if summary exists',
          },
          queryParams: {
            force: '(optional) Alternative to body parameter - force regeneration',
          },
          examples: {
            summarize_yesterday: {
              method: 'POST',
              headers: { 'X-API-Key': 'your-api-key' },
              body: {},
            },
            summarize_specific_date: {
              method: 'POST',
              headers: { 'X-API-Key': 'your-api-key' },
              body: {
                date: '2024-12-25',
              },
            },
            summarize_specific_feed: {
              method: 'POST',
              headers: { 'X-API-Key': 'your-api-key' },
              body: {
                feedName: 'TechCrunch',
                date: '2024-12-25',
              },
            },
          },
          currentRequest: {
            parsedDate: targetDate,
            feedName: validatedParams.feedName,
          },
        },
        null,
        2
      ),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (error) {
    if (error instanceof ValidationError) {
      logger.warn('Daily summary status check validation failed', {
        error: error.message,
        errors: error.errors,
      });
      return createValidationErrorResponse(error);
    }

    logger.error('Daily summary status check failed', error as Error);

    return createErrorResponse('Internal server error', 500, 'INTERNAL_ERROR', {
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
