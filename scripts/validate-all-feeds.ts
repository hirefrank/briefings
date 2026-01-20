#!/usr/bin/env tsx
import { config } from 'dotenv';

config({ path: '../.dev.vars' });

interface FeedValidationResult {
  id: string;
  name: string;
  url: string;
  isActive: boolean;
  isValid: boolean;
  error?: string;
  contentType?: string;
  feedType?: string;
}

async function validateRssFeed(
  url: string
): Promise<{ isValid: boolean; error?: string; contentType?: string; feedType?: string }> {
  try {
    // Check URL format
    const urlObj = new URL(url);
    if (!['http:', 'https:'].includes(urlObj.protocol)) {
      return { isValid: false, error: 'Invalid protocol (must be HTTP/HTTPS)' };
    }

    // Fetch the feed
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10 second timeout

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; FeedValidator/1.0)',
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
      },
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return { isValid: false, error: `HTTP ${response.status}: ${response.statusText}` };
    }

    const contentType = response.headers.get('content-type') || '';
    const text = await response.text();

    // Check if it's XML
    if (
      !text.trim().startsWith('<?xml') &&
      !text.trim().startsWith('<rss') &&
      !text.trim().startsWith('<feed')
    ) {
      return { isValid: false, error: 'Not XML content', contentType };
    }

    // Check for RSS or Atom indicators
    const isRss = text.includes('<rss') || text.includes('<channel>');
    const isAtom = text.includes('<feed') && text.includes('xmlns="http://www.w3.org/2005/Atom"');

    if (!isRss && !isAtom) {
      return { isValid: false, error: 'Not RSS or Atom feed', contentType };
    }

    return {
      isValid: true,
      contentType,
      feedType: isRss ? 'RSS' : 'Atom',
    };
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        return { isValid: false, error: 'Timeout (10s)' };
      }
      return { isValid: false, error: error.message };
    }
    return { isValid: false, error: 'Unknown error' };
  }
}

async function validateAllFeeds() {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || '6034f1c5d23e5503f6573740480cf0d6';
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  const databaseId = '8ae08ec3-59d5-41f3-a433-d8635fd31931';

  if (!apiToken) {
    throw new Error('CLOUDFLARE_API_TOKEN is required');
  }

  // Query function for D1
  const runQuery = async (sql: string, params: any[] = []) => {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sql,
          params,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Query failed: ${error}`);
    }

    const result = await response.json();
    return result.result[0];
  };

  console.log('🔍 Fetching all feeds from database...\n');

  const feedsResult = await runQuery(`SELECT id, name, url, isActive FROM Feed ORDER BY name`);

  const feeds = feedsResult.results || [];
  console.log(`Found ${feeds.length} total feeds\n`);

  const results: FeedValidationResult[] = [];

  // Validate each feed
  console.log('🔄 Validating feeds...\n');
  for (let i = 0; i < feeds.length; i++) {
    const feed = feeds[i];
    process.stdout.write(
      `\r[${i + 1}/${feeds.length}] Validating: ${feed.name.padEnd(50).slice(0, 50)}...`
    );

    const validation = await validateRssFeed(feed.url);

    results.push({
      id: feed.id,
      name: feed.name,
      url: feed.url,
      isActive: feed.isActive === 1,
      isValid: validation.isValid,
      error: validation.error,
      contentType: validation.contentType,
      feedType: validation.feedType,
    });

    // Small delay to avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  console.log('\n\n📊 Validation Results:\n');

  // Summary
  const validFeeds = results.filter((r) => r.isValid);
  const invalidFeeds = results.filter((r) => !r.isValid);
  const activeInvalidFeeds = invalidFeeds.filter((r) => r.isActive);

  console.log(
    `✅ Valid feeds: ${validFeeds.length}/${feeds.length} (${((validFeeds.length / feeds.length) * 100).toFixed(1)}%)`
  );
  console.log(
    `❌ Invalid feeds: ${invalidFeeds.length}/${feeds.length} (${((invalidFeeds.length / feeds.length) * 100).toFixed(1)}%)`
  );
  console.log(`⚠️  Active invalid feeds: ${activeInvalidFeeds.length}\n`);

  // Group invalid feeds by error type
  const errorGroups = new Map<string, FeedValidationResult[]>();
  invalidFeeds.forEach((feed) => {
    const error = feed.error || 'Unknown error';
    if (!errorGroups.has(error)) {
      errorGroups.set(error, []);
    }
    errorGroups.get(error)!.push(feed);
  });

  // Show invalid feeds grouped by error
  console.log('❌ INVALID FEEDS BY ERROR TYPE:\n');

  Array.from(errorGroups.entries())
    .sort((a, b) => b[1].length - a[1].length)
    .forEach(([error, feeds]) => {
      console.log(`\n${error} (${feeds.length} feeds):`);
      console.log('─'.repeat(80));
      feeds.forEach((feed) => {
        const status = feed.isActive ? '🟢 ACTIVE' : '⚪ inactive';
        console.log(`${status} ${feed.name}`);
        console.log(`     URL: ${feed.url}`);
        console.log(`     ID:  ${feed.id}`);
      });
    });

  // Show valid feeds summary
  console.log('\n\n✅ VALID FEEDS SUMMARY:\n');
  console.log(`Total valid: ${validFeeds.length}`);
  console.log(`RSS feeds: ${validFeeds.filter((f) => f.feedType === 'RSS').length}`);
  console.log(`Atom feeds: ${validFeeds.filter((f) => f.feedType === 'Atom').length}`);

  // Export results to file
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const outputFile = `./feed-validation-results-${timestamp}.json`;

  await Bun.write(
    outputFile,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        summary: {
          total: feeds.length,
          valid: validFeeds.length,
          invalid: invalidFeeds.length,
          activeInvalid: activeInvalidFeeds.length,
        },
        invalidFeeds,
        validFeeds: validFeeds.map((f) => ({
          id: f.id,
          name: f.name,
          url: f.url,
          feedType: f.feedType,
        })),
      },
      null,
      2
    )
  );

  console.log(`\n\n💾 Full results exported to: ${outputFile}`);
}

// Run the validation
validateAllFeeds()
  .then(() => {
    console.log('\n\n✨ Validation complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n\n❌ Error:', error);
    process.exit(1);
  });
