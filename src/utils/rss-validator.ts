/**
 * RSS Feed Validation Utility for Briefings App
 * Consistent with admin app's rss-validator.ts
 */

export type ValidationErrorType =
  | 'HTTP_ERROR' // Non-2xx HTTP status
  | 'NOT_FOUND' // Specifically 404
  | 'NOT_XML' // Valid HTTP response but not XML content
  | 'NOT_RSS' // Valid XML but not RSS/Atom feed
  | 'MALFORMED' // RSS structure but malformed/invalid
  | 'TIMEOUT' // Request timeout
  | 'NETWORK_ERROR' // Connection/network issues
  | 'INVALID_URL'; // Invalid URL format

export interface FeedValidationResult {
  url: string;
  isValid: boolean;
  error?: string;
  errorType?: ValidationErrorType;
  feedType?: 'rss' | 'atom' | 'unknown';
  title?: string;
}

/**
 * Validates a single RSS feed URL
 */
export async function validateRssFeed(url: string): Promise<FeedValidationResult> {
  try {
    // Basic URL validation
    const parsedUrl = new URL(url);

    // Ensure it's HTTP or HTTPS
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return {
        url,
        isValid: false,
        error: 'Invalid protocol. Only HTTP and HTTPS are supported.',
        errorType: 'INVALID_URL',
      };
    }

    // Fetch the feed with a timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10 second timeout

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; FeedValidator/1.0)',
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errorType = response.status === 404 ? 'NOT_FOUND' : 'HTTP_ERROR';
      const errorMessage =
        response.status === 404
          ? 'URL not found (404) - this page does not exist'
          : `HTTP ${response.status}: ${response.statusText}`;

      return {
        url,
        isValid: false,
        error: errorMessage,
        errorType,
      };
    }

    // Check content type
    const contentType = response.headers.get('content-type') || '';
    const isXmlContent =
      contentType.includes('xml') || contentType.includes('rss') || contentType.includes('atom');

    // Read the response text
    const text = await response.text();

    // Basic XML validation
    if (
      !text.trim().startsWith('<?xml') &&
      !text.trim().startsWith('<rss') &&
      !text.trim().startsWith('<feed')
    ) {
      // Check if it looks like HTML
      const isHtml =
        text.toLowerCase().includes('<!doctype html') ||
        text.toLowerCase().includes('<html') ||
        text.toLowerCase().includes('<body');

      const errorMessage = isHtml
        ? 'This URL returns an HTML page, not an RSS feed'
        : 'Response does not appear to be XML content';

      return {
        url,
        isValid: false,
        error: errorMessage,
        errorType: 'NOT_XML',
      };
    }

    // Check for RSS or Atom feed indicators
    const lowerText = text.toLowerCase();
    const isRss = lowerText.includes('<rss') || lowerText.includes('<channel>');
    const isAtom =
      lowerText.includes('<feed') && lowerText.includes('xmlns="http://www.w3.org/2005/atom"');

    if (!isRss && !isAtom) {
      // It's XML but not RSS/Atom
      return {
        url,
        isValid: false,
        error: 'This is valid XML but not an RSS or Atom feed',
        errorType: 'NOT_RSS',
      };
    }

    // Try to extract the feed title
    let title: string | undefined;
    const titleMatch = text.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch) {
      title = titleMatch[1].trim();
      // Decode HTML entities
      title = title
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
    }

    return {
      url,
      isValid: true,
      feedType: isRss ? 'rss' : isAtom ? 'atom' : 'unknown',
      title,
    };
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        return {
          url,
          isValid: false,
          error: 'Request timeout - feed took too long to respond (10s)',
          errorType: 'TIMEOUT',
        };
      }

      // Network/connection errors
      if (
        error.message.includes('fetch') ||
        error.message.includes('network') ||
        error.message.includes('ENOTFOUND') ||
        error.message.includes('ECONNREFUSED')
      ) {
        return {
          url,
          isValid: false,
          error: `Network error: ${error.message}`,
          errorType: 'NETWORK_ERROR',
        };
      }

      // URL parsing errors
      if (error.message.includes('Invalid URL')) {
        return {
          url,
          isValid: false,
          error: `Invalid URL format: ${error.message}`,
          errorType: 'INVALID_URL',
        };
      }

      return {
        url,
        isValid: false,
        error: error.message,
        errorType: 'NETWORK_ERROR',
      };
    }
    return {
      url,
      isValid: false,
      error: 'Unknown error occurred',
      errorType: 'NETWORK_ERROR',
    };
  }
}

