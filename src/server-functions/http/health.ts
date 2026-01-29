// Env type is globally defined
import { getDb, setupDb } from '../../db.js';
import { sql } from 'kysely';

/**
 * Health check endpoint
 * GET /health
 */
export async function GET(env: Env): Promise<Response> {
  try {
    const checks = {
      database: false,
      kv: false,
      r2: false,
      queues: false,
    };

    const errors: string[] = [];

    // Check database connectivity
    try {
      await setupDb(env);
      const db = getDb(env);
      await sql`SELECT 1`.execute(db);
      checks.database = true;
    } catch (error) {
      errors.push(`Database: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    // Check KV namespace access
    let kvDebug: Record<string, unknown> = {};
    try {
      if (env.APP_CONFIG_KV) {
        // Test health check key
        await env.APP_CONFIG_KV.get('health-check');

        // Test prompt key
        const promptKey = 'prompts/daily-summary.yaml';
        const promptValue = await env.APP_CONFIG_KV.get(promptKey, 'text');
        kvDebug = {
          testKey: promptKey,
          found: !!promptValue,
          valueLength: promptValue ? promptValue.length : 0,
        };

        checks.kv = true;
      } else {
        errors.push('KV: APP_CONFIG_KV binding not found');
      }
    } catch (error) {
      errors.push(`KV: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    // Check R2 bucket access
    try {
      if (env.MARKDOWN_OUTPUT_R2) {
        // Try to list objects (should work even if bucket is empty)
        await env.MARKDOWN_OUTPUT_R2.list({ limit: 1 });
        checks.r2 = true;
      } else {
        errors.push('R2: MARKDOWN_OUTPUT_R2 binding not found');
      }
    } catch (error) {
      errors.push(`R2: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    // Check queue bindings (basic existence check)
    try {
      const queueBindings = [
        'FEED_FETCH_QUEUE',
        'DAILY_SUMMARY_INITIATOR_QUEUE',
        'DAILY_SUMMARY_PROCESSOR_QUEUE',
        'WEEKLY_DIGEST_QUEUE',
      ];

      const missingQueues = queueBindings.filter((binding) => !(binding in env));

      if (missingQueues.length === 0) {
        checks.queues = true;
      } else {
        errors.push(`Queues: Missing bindings - ${missingQueues.join(', ')}`);
      }
    } catch (error) {
      errors.push(`Queues: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    // Determine overall status
    const allHealthy = Object.values(checks).every(Boolean);
    const status = allHealthy
      ? 'healthy'
      : errors.length === Object.keys(checks).length
        ? 'unhealthy'
        : 'degraded';

    const response = {
      status,
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      environment: env.ENVIRONMENT || 'unknown',
      checks,
      kvDebug,
      errors: errors.length > 0 ? errors : undefined,
    };

    const statusCode = status === 'healthy' ? 200 : status === 'degraded' ? 200 : 503;

    return new Response(JSON.stringify(response, null, 2), {
      status: statusCode,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });
  } catch (error) {
    // Fallback error response
    const errorResponse = {
      status: 'error',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };

    return new Response(JSON.stringify(errorResponse, null, 2), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });
  }
}
