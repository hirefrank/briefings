#!/usr/bin/env node

// This script uses the EXACT same validation logic as rss-validator.ts

/**
 * Validates a single RSS feed URL - exact same logic as rss-validator.ts
 */
async function validateRssFeed(url) {
  try {
    // Basic URL validation
    const parsedUrl = new URL(url);

    // Ensure it's HTTP or HTTPS
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return {
        url,
        isValid: false,
        error: 'Invalid protocol. Only HTTP and HTTPS are supported.',
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
      return {
        url,
        isValid: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
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
      return {
        url,
        isValid: false,
        error: 'Response does not appear to be XML',
      };
    }

    // Check for RSS or Atom feed indicators
    const lowerText = text.toLowerCase();
    const isRss = lowerText.includes('<rss') || lowerText.includes('<channel>');
    const isAtom =
      lowerText.includes('<feed') && lowerText.includes('xmlns="http://www.w3.org/2005/atom"');

    if (!isRss && !isAtom) {
      // If no XML content type and no RSS/Atom markers, it's probably not a feed
      if (!isXmlContent) {
        return {
          url,
          isValid: false,
          error: 'URL does not appear to be an RSS or Atom feed',
        };
      }
    }

    // Try to extract the feed title
    let title;
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
          error: 'Request timeout - feed took too long to respond',
        };
      }
      return {
        url,
        isValid: false,
        error: error.message,
      };
    }
    return {
      url,
      isValid: false,
      error: 'Unknown error occurred',
    };
  }
}

async function main() {
  // Read feeds from the file we created
  const fs = await import('fs');
  const feedsData = fs.readFileSync('all-feeds.txt', 'utf-8');
  const feeds = feedsData
    .trim()
    .split('\n')
    .map((line) => {
      const [isActive, name, url, id] = line.split('|');
      return { isActive: isActive === '1', name, url, id };
    });

  console.log(`Validating ${feeds.length} feeds using the same logic as rss-validator.ts...`);
  console.log('');

  const results = [];
  const BATCH_SIZE = 5; // Same as rss-validator.ts

  // Process in batches like the original
  for (let i = 0; i < feeds.length; i += BATCH_SIZE) {
    const batch = feeds.slice(i, i + BATCH_SIZE);
    console.log(
      `\nProcessing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(feeds.length / BATCH_SIZE)}...`
    );

    const batchResults = await Promise.all(
      batch.map(async (feed) => {
        const validation = await validateRssFeed(feed.url);
        return { ...feed, ...validation };
      })
    );

    batchResults.forEach((result) => {
      const status = result.isValid ? '✅' : '❌';
      const feedType = result.feedType ? ` (${result.feedType})` : '';
      const error = result.error ? ` - ${result.error}` : '';
      console.log(`${status} ${result.name}${feedType}${error}`);
    });

    results.push(...batchResults);
  }

  // Summary
  console.log('\n📊 VALIDATION RESULTS:');
  console.log('======================');

  const validFeeds = results.filter((r) => r.isValid);
  const invalidFeeds = results.filter((r) => !r.isValid);
  const activeInvalidFeeds = invalidFeeds.filter((r) => r.isActive);

  console.log(
    `\n✅ Valid feeds: ${validFeeds.length}/${feeds.length} (${((validFeeds.length / feeds.length) * 100).toFixed(1)}%)`
  );
  console.log(
    `❌ Invalid feeds: ${invalidFeeds.length}/${feeds.length} (${((invalidFeeds.length / feeds.length) * 100).toFixed(1)}%)`
  );
  console.log(`⚠️  Active invalid feeds: ${activeInvalidFeeds.length}`);

  // Group by error type
  const errorGroups = {};
  invalidFeeds.forEach((feed) => {
    const error = feed.error || 'Unknown error';
    if (!errorGroups[error]) {
      errorGroups[error] = [];
    }
    errorGroups[error].push(feed);
  });

  console.log('\n❌ INVALID FEEDS BY ERROR TYPE:');
  console.log('================================\n');

  Object.entries(errorGroups)
    .sort((a, b) => b[1].length - a[1].length)
    .forEach(([error, feedList]) => {
      console.log(`${error} (${feedList.length} feeds):`);
      feedList.forEach((feed) => {
        const status = feed.isActive ? '🟢 ACTIVE' : '⚪ inactive';
        console.log(`  ${status} ${feed.name}`);
        console.log(`       URL: ${feed.url}`);
        console.log(`       ID:  ${feed.id}`);
      });
      console.log('');
    });

  // Save detailed results
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  fs.writeFileSync(
    `feed-validation-results-${timestamp}.json`,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        summary: {
          total: feeds.length,
          valid: validFeeds.length,
          invalid: invalidFeeds.length,
          activeInvalid: activeInvalidFeeds.length,
        },
        errorBreakdown: Object.fromEntries(
          Object.entries(errorGroups).map(([error, feeds]) => [error, feeds.length])
        ),
        invalidFeeds,
        validFeeds: validFeeds.map((f) => ({
          id: f.id,
          name: f.name,
          url: f.url,
          feedType: f.feedType,
          title: f.title,
          isActive: f.isActive,
        })),
      },
      null,
      2
    )
  );

  console.log(`\n💾 Detailed results saved to: feed-validation-results-${timestamp}.json`);
}

main().catch(console.error);
