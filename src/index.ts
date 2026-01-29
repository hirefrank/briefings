/**
 * Briefings - Unified Cloudflare Worker with Hono
 * Handles HTTP endpoints, cron schedules, and queue processing
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { MessageBatch, ScheduledEvent, Message, ExecutionContext } from '@cloudflare/workers-types';
import { setupDb } from './db';

// Import HTTP handlers
import { GET as healthGET } from './server-functions/http/health';
import { POST as feedFetchPOST, GET as feedFetchGET } from './server-functions/http/run-feed-fetch';
import {
  POST as dailySummaryPOST,
  GET as dailySummaryGET,
} from './server-functions/http/run-daily-summary';
import {
  POST as weeklySummaryPOST,
  GET as weeklySummaryGET,
} from './server-functions/http/run-weekly-summary';
import seedDatabase from './server-functions/http/seed-database';
import testPreviousContext from './server-functions/http/test-previous-context';
import { requireApiKey, checkApiKey } from './server-functions/http/middleware';

// Import cron handlers
import { scheduled as feedFetchCron } from './server-functions/crons/initiate-feed-fetch';
import { scheduled as dailySummaryCron } from './server-functions/crons/initiate-daily-summary';
import { scheduled as validateFeedsCron } from './server-functions/crons/validate-feeds';

// Import queue handlers
import { queue as feedFetchQueue } from './server-functions/queues/feed-fetch-consumer';
import { queue as dailySummaryInitiatorQueue } from './server-functions/queues/daily-summary-initiator';
import { queue as dailySummaryProcessorQueue } from './server-functions/queues/daily-summary-processor';
import { queue as weeklyDigestQueue } from './server-functions/queues/weekly-digest-consumer';

// Create Hono app with Cloudflare Workers bindings
const app = new Hono<{
  Bindings: Env;
  Variables: {
    authenticated?: boolean;
  };
}>();

// Middleware
app.use('*', logger());
app.use('*', cors());

// Initialize DB for all routes
app.use('*', async (c, next) => {
  await setupDb(c.env);
  await next();
});

// Root endpoint
app.get('/', (c) => {
  return c.redirect('/api/health');
});

// API routes
const api = new Hono<{
  Bindings: Env;
  Variables: {
    authenticated?: boolean;
  };
}>();

// Health check
api.get('/health', async (c) => {
  const response = await healthGET(c.env);
  return response;
});

// Feed fetch endpoints
api.get('/run/feed-fetch', checkApiKey, async (c) => {
  const authenticated = c.get('authenticated') || false;
  const response = await feedFetchGET(c.req.raw, c.env, { authenticated });
  return response;
});

api.post('/run/feed-fetch', requireApiKey, async (c) => {
  const response = await feedFetchPOST(c.req.raw, c.env);
  return response;
});

// Daily summary endpoints
api.get('/run/daily-summary', checkApiKey, async (c) => {
  const authenticated = c.get('authenticated') || false;
  const response = await dailySummaryGET(c.req.raw, c.env, { authenticated });
  return response;
});

api.post('/run/daily-summary', requireApiKey, async (c) => {
  const response = await dailySummaryPOST(c.req.raw, c.env);
  return response;
});

// Weekly summary endpoints
api.get('/run/weekly-summary', checkApiKey, async (c) => {
  const authenticated = c.get('authenticated') || false;
  const response = await weeklySummaryGET(c.req.raw, c.env, { authenticated });
  return response;
});

api.post('/run/weekly-summary', requireApiKey, async (c) => {
  const response = await weeklySummaryPOST(c.req.raw, c.env);
  return response;
});

// Database seeding (development)
api.post('/seed', requireApiKey, async (c) => {
  const response = await seedDatabase(c.env);
  return response;
});

// Test endpoint for previous context (development)
api.use('/test/previous-context/*', requireApiKey);
api.use('/test/previous-context', requireApiKey);
api.route('/test/previous-context', testPreviousContext);

app.route('/api', api);

// 404 handler
app.notFound((c) => {
  return c.json({ error: 'Not found' }, 404);
});

// Error handler
app.onError((err, c) => {
  console.error(`Error: ${err}`);
  return c.json({ error: err.message || 'Internal server error' }, 500);
});

// Export handlers for Cloudflare Workers
export default {
  /**
   * HTTP request handler
   */
  fetch: app.fetch,

  /**
   * Cron handler
   */
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    // Initialize database
    await setupDb(env);

    console.warn(`Scheduled event triggered: ${event.cron} at ${new Date().toISOString()}`);

    // Map cron expressions to handlers
    const cronHandlers: Record<string, typeof feedFetchCron> = {
      '0 */4 * * *': feedFetchCron, // Every 4 hours
      '0 10 * * *': dailySummaryCron, // Daily at 5 AM EST (10 AM UTC)
      '0 6 * * *': validateFeedsCron, // Daily at 1 AM EST (6 AM UTC) - validate feeds
    };

    const handler = cronHandlers[event.cron];

    if (handler) {
      try {
        await handler(event as any, env, ctx);
      } catch (error) {
        console.error(`Cron handler error for ${event.cron}:`, error);
        throw error;
      }
    } else {
      console.warn(`No handler found for cron expression: ${event.cron}`);
    }
  },

  /**
   * Queue handler
   */
  async queue(batch: MessageBatch<unknown>, env: Env, ctx: ExecutionContext): Promise<void> {
    // Initialize database
    await setupDb(env);

    console.warn(`Queue batch received: ${batch.queue} with ${batch.messages.length} messages`);

    // Map queue names to handlers (simplified from 12 queues to 4)
    type QueueHandler = (batch: any, env: Env) => Promise<void>;
    const queueHandlers: Record<string, QueueHandler> = {
      'briefings-feed-fetch': feedFetchQueue,
      'briefings-daily-summary-initiator': dailySummaryInitiatorQueue,
      'briefings-daily-summary-processor': dailySummaryProcessorQueue,
      'briefings-weekly-digest': weeklyDigestQueue,
    };

    const handler = queueHandlers[batch.queue];

    if (handler) {
      try {
        await handler(batch as any, env);
      } catch (error) {
        console.error(`Queue handler error for ${batch.queue}:`, error);
        throw error;
      }
    } else {
      console.error(`No handler found for queue: ${batch.queue}`);
      // Acknowledge all messages to prevent retries for unknown queues
      batch.messages.forEach((msg) => (msg as Message<unknown>).ack());
    }
  },
};
