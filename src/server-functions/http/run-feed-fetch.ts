// Env type is globally defined
import { Logger, FeedService } from '../../services/index.js';
import { QueueDispatcher } from '../utils/queue-dispatcher.js';
import {
  parseRequestBody,
  createSuccessResponse,
  createErrorResponse,
  createValidationErrorResponse,
  FeedFetchRequestSchema,
  ValidationError,
} from './schemas.js';

/**
 * Initiate feed fetch task
 * POST /run/feed-fetch
 *
 * Body (JSON):
 * - feedUrl (optional): Specific feed URL to fetch
 * - feedName (optional): Name of the specific feed (required if feedUrl provided)
 * - force (optional): Force fetch even if recently fetched
 *
 * If no feedUrl provided, all active feeds will be fetched
 */
export async function POST(request: Request, env: Env): Promise<Response> {
  const logger = Logger.forService('FeedFetchEndpoint');

  try {
    logger.info('Feed fetch request received');

    // Parse and validate request body
    const body = await parseRequestBody(request, FeedFetchRequestSchema);

    // Initialize queue dispatcher
    const queueDispatcher = QueueDispatcher.create(env);

    let requestIds: string[] = [];
    let message: string;

    if (body.feedUrl && body.feedName) {
      // Fetch specific feed
      const requestId = await queueDispatcher.sendToFeedFetchQueue(body.feedUrl, body.feedName);
      requestIds = [requestId];
      message = `Feed fetch task initiated for ${body.feedName}`;

      logger.info('Specific feed fetch task initiated', {
        feedName: body.feedName,
        feedUrl: body.feedUrl,
        requestId,
        force: body.force,
      });
    } else {
      // Fetch all active feeds from database
      const feedService = new FeedService({ logger });
      const feeds = await feedService.getActiveFeeds(env);

      if (feeds.length === 0) {
        logger.warn('No active feeds found');
        return createErrorResponse('No active feeds configured', 404);
      }

      // Send message for each feed
      for (const feed of feeds) {
        const requestId = await queueDispatcher.sendToFeedFetchQueue(feed.url, feed.name);
        requestIds.push(requestId);
      }

      message = `Feed fetch tasks initiated for ${requestIds.length} feeds`;

      logger.info('Multiple feed fetch tasks initiated', {
        feedCount: requestIds.length,
        totalFeeds: feeds.length,
        force: body.force,
      });
    }

    return createSuccessResponse(message, {
      requestIds,
      feedCount: requestIds.length,
      force: body.force,
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      logger.warn('Feed fetch request validation failed', {
        error: error.message,
        errors: error.errors,
      });
      return createValidationErrorResponse(error);
    }

    logger.error('Feed fetch request failed', error as Error);

    return createErrorResponse('Internal server error', 500, 'INTERNAL_ERROR', {
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * GET method provides endpoint information
 */
export async function GET(request: Request, env: Env, ctx: unknown): Promise<Response> {
  // Check if authenticated (set by checkApiKey middleware)
  const authenticated = (ctx as { authenticated?: boolean })?.authenticated || false;

  if (!authenticated) {
    return createErrorResponse(
      'Authentication required. Please provide X-API-Key header.',
      401,
      'AUTHENTICATION_REQUIRED'
    );
  }

  return new Response(
    JSON.stringify(
      {
        endpoint: '/run/feed-fetch',
        method: 'POST',
        description: 'Trigger RSS feed fetching',
        headers: {
          'X-API-Key': 'Required - Your API key',
          'Content-Type': 'application/json (for POST body)',
        },
        body: {
          feedUrl: '(optional) Specific feed URL to fetch',
          feedName: '(optional) Name of the specific feed (required if feedUrl provided)',
          force: '(optional) Force fetch even if recently fetched',
        },
        note: 'If no feedUrl provided, all active feeds from database will be fetched',
        examples: {
          fetch_all_feeds: {
            method: 'POST',
            headers: { 'X-API-Key': 'your-api-key' },
            body: {},
          },
          fetch_specific_feed: {
            method: 'POST',
            headers: { 'X-API-Key': 'your-api-key' },
            body: {
              feedUrl: 'https://example.com/rss.xml',
              feedName: 'Example Feed',
            },
          },
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
}
