import { Context, Next } from 'hono';
import { createErrorResponse } from './schemas.js';

/**
 * Timing-safe string comparison using crypto.subtle.timingSafeEqual.
 * Returns false immediately for length mismatches (length is not secret).
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const encoder = new TextEncoder();
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);
  // crypto.subtle.timingSafeEqual is available in Cloudflare Workers runtime
  return (crypto.subtle as unknown as { timingSafeEqual(a: BufferSource, b: BufferSource): boolean }).timingSafeEqual(bufA, bufB);
}

/**
 * Middleware to require API key authentication
 * Checks for X-API-Key header and validates against ADMIN_API_KEY secret
 */
export async function requireApiKey(
  c: Context<{ Bindings: Env; Variables: { authenticated?: boolean } }>,
  next: Next
) {
  const apiKey = c.req.header('X-API-Key');

  if (!apiKey) {
    return createErrorResponse(
      'Missing API key. Please provide X-API-Key header.',
      401,
      'MISSING_API_KEY'
    );
  }

  // Check both API_KEY and ADMIN_API_KEY for backward compatibility
  const validApiKey = c.env.API_KEY || c.env.ADMIN_API_KEY;

  if (!validApiKey) {
    // If no API key is configured, log warning but allow request in development
    if (c.env.ENVIRONMENT === 'development') {
      console.warn('API_KEY not configured - allowing request in development mode');
      return next();
    }

    return createErrorResponse('Authentication not configured', 500, 'AUTH_NOT_CONFIGURED');
  }

  if (!timingSafeEqual(apiKey, validApiKey)) {
    return createErrorResponse('Invalid API key', 401, 'INVALID_API_KEY');
  }

  // Valid API key - continue
  return next();
}

/**
 * Middleware to optionally check API key
 * Used for endpoints that show different content based on authentication
 * Sets c.set('authenticated', true/false) for downstream handlers
 */
export async function checkApiKey(
  c: Context<{ Bindings: Env; Variables: { authenticated?: boolean } }>,
  next: Next
) {
  const apiKey = c.req.header('X-API-Key');
  const validApiKey = c.env.API_KEY || c.env.ADMIN_API_KEY;

  if (!validApiKey || !apiKey) {
    c.set('authenticated', false);
    return next();
  }

  const authenticated = timingSafeEqual(apiKey, validApiKey);
  c.set('authenticated', authenticated);

  return next();
}
