#!/usr/bin/env node

// Simple Node.js script to validate RSS feeds
const https = require('https');
const http = require('http');

async function validateRssFeed(url) {
  try {
    const urlObj = new URL(url);
    if (!['http:', 'https:'].includes(urlObj.protocol)) {
      return { isValid: false, error: 'Invalid protocol' };
    }

    return new Promise((resolve) => {
      const client = urlObj.protocol === 'https:' ? https : http;

      const req = client.get(
        url,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; FeedValidator/1.0)',
            Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
          },
          timeout: 10000,
        },
        (res) => {
          if (res.statusCode !== 200) {
            resolve({ isValid: false, error: `HTTP ${res.statusCode}` });
            return;
          }

          const contentType = res.headers['content-type'] || '';
          let body = '';

          res.on('data', (chunk) => {
            body += chunk;
            // Limit response size
            if (body.length > 100000) {
              req.abort();
              resolve({ isValid: false, error: 'Response too large' });
            }
          });

          res.on('end', () => {
            // Check if it's XML
            const trimmed = body.trim();
            if (
              !trimmed.startsWith('<?xml') &&
              !trimmed.startsWith('<rss') &&
              !trimmed.startsWith('<feed')
            ) {
              resolve({ isValid: false, error: 'Not XML content', contentType });
              return;
            }

            // Check for RSS or Atom indicators
            const isRss = body.includes('<rss') || body.includes('<channel>');
            const isAtom =
              body.includes('<feed') && body.includes('xmlns="http://www.w3.org/2005/Atom"');

            if (!isRss && !isAtom) {
              resolve({ isValid: false, error: 'Not RSS or Atom feed', contentType });
              return;
            }

            resolve({
              isValid: true,
              contentType,
              feedType: isRss ? 'RSS' : 'Atom',
            });
          });
        }
      );

      req.on('error', (err) => {
        resolve({ isValid: false, error: err.message });
      });

      req.on('timeout', () => {
        req.abort();
        resolve({ isValid: false, error: 'Timeout (10s)' });
      });
    });
  } catch (error) {
    return { isValid: false, error: error.message };
  }
}

async function main() {
  const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
  const accountId = '6034f1c5d23e5503f6573740480cf0d6';
  const databaseId = '8ae08ec3-59d5-41f3-a433-d8635fd31931';

  if (!CLOUDFLARE_API_TOKEN) {
    console.error('❌ CLOUDFLARE_API_TOKEN environment variable is required');
    console.error('Run: export CLOUDFLARE_API_TOKEN=your_token_here');
    process.exit(1);
  }

  // Query D1 for all feeds
  console.log('🔍 Fetching all feeds from database...\n');

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sql: 'SELECT id, name, url, isActive FROM Feed ORDER BY name',
      }),
    }
  );

  if (!response.ok) {
    console.error('❌ Failed to fetch feeds from database');
    process.exit(1);
  }

  const result = await response.json();
  const feeds = result.result[0].results || [];

  console.log(`Found ${feeds.length} total feeds\n`);
  console.log('🔄 Validating feeds (this will take a few minutes)...\n');

  const results = [];

  // Validate each feed
  for (let i = 0; i < feeds.length; i++) {
    const feed = feeds[i];
    process.stdout.write(
      `\r[${i + 1}/${feeds.length}] Validating: ${feed.name.padEnd(50).slice(0, 50)}...`
    );

    const validation = await validateRssFeed(feed.url);

    results.push({
      ...feed,
      isActive: feed.isActive === 1,
      ...validation,
    });

    // Small delay to avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, 200));
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
  const errorGroups = {};
  invalidFeeds.forEach((feed) => {
    const error = feed.error || 'Unknown error';
    if (!errorGroups[error]) {
      errorGroups[error] = [];
    }
    errorGroups[error].push(feed);
  });

  // Show invalid feeds grouped by error
  console.log('❌ INVALID FEEDS BY ERROR TYPE:\n');

  Object.entries(errorGroups)
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

  // Save results
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const fs = require('fs');
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

  console.log(`\n\n💾 Full results saved to: feed-validation-results-${timestamp}.json`);
}

main().catch(console.error);
