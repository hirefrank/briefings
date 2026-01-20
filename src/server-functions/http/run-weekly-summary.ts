// Env type is globally defined
import { Logger } from '../../services/index.js';
import { QueueDispatcher } from '../utils/queue-dispatcher.js';
import {
  parseRequestBody,
  createSuccessResponse,
  createErrorResponse,
  createValidationErrorResponse,
  WeeklySummaryRequestSchema,
  ValidationError,
  calculateWeekRange,
} from './schemas.js';

/**
 * Initiate weekly summary generation task
 * POST /run/weekly-summary
 *
 * Body (JSON):
 * - weekStartDate (optional): Start date of week (YYYY-MM-DD format). Must be provided with weekEndDate.
 * - weekEndDate (optional): End date of week (YYYY-MM-DD format). Must be provided with weekStartDate.
 * - force (optional): Force regeneration even if summary already exists
 *
 * If no dates provided, defaults to current week (Monday to today)
 */
export async function POST(request: Request, env: Env): Promise<Response> {
  const logger = Logger.forService('WeeklySummaryEndpoint');

  try {
    logger.info('Weekly summary request received');

    // Parse and validate request body
    const body = await parseRequestBody(request, WeeklySummaryRequestSchema);

    // Calculate week range (defaults to previous week if not specified)
    const { weekStartDate, weekEndDate } = calculateWeekRange(body.weekStartDate, body.weekEndDate);

    // Validate dates are not in the future
    const today = new Date().toISOString().split('T')[0];
    if (weekStartDate > today || weekEndDate > today) {
      logger.warn('Weekly summary requested for future dates', { weekStartDate, weekEndDate });
      return createErrorResponse('Cannot generate summary for future dates', 400, 'INVALID_DATE', {
        weekStartDate,
        weekEndDate,
        today,
      });
    }

    // Validate week span (should be reasonable, e.g., 1-14 days)
    const startDate = new Date(weekStartDate);
    const endDate = new Date(weekEndDate);
    const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));

    if (daysDiff < 1 || daysDiff > 14) {
      logger.warn('Invalid week span requested', { weekStartDate, weekEndDate, daysDiff });
      return createErrorResponse(
        'Week span must be between 1 and 14 days',
        400,
        'INVALID_WEEK_SPAN',
        { weekStartDate, weekEndDate, daysDiff }
      );
    }

    // Initialize queue dispatcher
    const queueDispatcher = QueueDispatcher.create(env);

    // Send weekly summary initiator task to queue
    const requestId = await queueDispatcher.sendToWeeklySummaryInitiatorQueue(
      weekStartDate,
      weekEndDate,
      body.force,
      body.feedGroupId
    );

    const message = `Weekly summary task initiated for ${weekStartDate} to ${weekEndDate}`;

    logger.info('Weekly summary task initiated', {
      weekStartDate,
      weekEndDate,
      daysDiff,
      requestId,
      force: body.force,
      feedGroupId: body.feedGroupId,
    });

    return createSuccessResponse(message, {
      requestId,
      weekStartDate,
      weekEndDate,
      daysDiff,
      force: body.force,
      feedGroupId: body.feedGroupId,
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      logger.warn('Weekly summary request validation failed', {
        error: error.message,
        errors: error.errors,
      });
      return createValidationErrorResponse(error);
    }

    logger.error('Weekly summary request failed', error as Error);

    return createErrorResponse('Internal server error', 500, 'INTERNAL_ERROR', {
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * GET method for checking status or getting information
 */
export async function GET(
  request: Request,
  env: Env,
  ctx?: { authenticated?: boolean }
): Promise<Response> {
  const logger = Logger.forService('WeeklySummaryEndpoint');

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
    const weekStartDate = url.searchParams.get('weekStartDate');
    const weekEndDate = url.searchParams.get('weekEndDate');

    // Parse query parameters using the same schema
    const params = {
      weekStartDate: weekStartDate || undefined,
      weekEndDate: weekEndDate || undefined,
    };

    const validatedParams = WeeklySummaryRequestSchema.parse(params);

    // Calculate week range (defaults to previous week if not specified)
    const weekRange = calculateWeekRange(
      validatedParams.weekStartDate,
      validatedParams.weekEndDate
    );

    // Calculate additional information
    const startDate = new Date(weekRange.weekStartDate);
    const endDate = new Date(weekRange.weekEndDate);
    const daysDiff =
      Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    // Return API documentation with examples
    return new Response(
      JSON.stringify(
        {
          endpoint: '/run/weekly-summary',
          method: 'POST',
          description: 'Trigger weekly summary generation',
          headers: {
            'X-API-Key': 'Required - Your API key',
            'Content-Type': 'application/json (for POST body)',
          },
          body: {
            weekStartDate:
              '(optional) Start date in YYYY-MM-DD format. Defaults to previous Monday.',
            weekEndDate: '(optional) End date in YYYY-MM-DD format. Defaults to previous Sunday.',
            force: '(optional) Force regeneration even if summary exists',
            feedGroupId: '(optional) UUID of feed group to filter by',
          },
          queryParams: {
            force: '(optional) Alternative to body parameter - force regeneration',
          },
          workflow: [
            'Initiator: Validate dates and trigger aggregation',
            'Aggregator: Collect daily summaries and prepare data',
            'Generator: Create weekly content using AI',
            'Postprocessor: Extract topics and generate title',
            'Finalizer: Assemble final summary and trigger publishing',
          ],
          examples: {
            summarize_last_week: {
              method: 'POST',
              headers: { 'X-API-Key': 'your-api-key' },
              body: {},
            },
            summarize_specific_week: {
              method: 'POST',
              headers: { 'X-API-Key': 'your-api-key' },
              body: {
                weekStartDate: '2024-12-16',
                weekEndDate: '2024-12-22',
              },
            },
          },
          currentRequest: {
            parsedWeekStartDate: weekRange.weekStartDate,
            parsedWeekEndDate: weekRange.weekEndDate,
            daysDiff,
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
      logger.warn('Weekly summary status check validation failed', {
        error: error.message,
        errors: error.errors,
      });
      return createValidationErrorResponse(error);
    }

    logger.error('Weekly summary status check failed', error as Error);

    return createErrorResponse('Internal server error', 500, 'INTERNAL_ERROR', {
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
