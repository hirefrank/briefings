#!/usr/bin/env node

import fs from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load API token from .dev.vars
function loadApiToken() {
  try {
    const devVarsPath = join(__dirname, '../../../.dev.vars');
    const devVars = fs.readFileSync(devVarsPath, 'utf-8');
    const tokenMatch = devVars.match(/CLOUDFLARE_API_TOKEN=["']?([^"'\n]+)["']?/);
    if (tokenMatch) {
      return tokenMatch[1];
    }
  } catch (e) {
    console.error('Failed to load .dev.vars:', e.message);
  }
  return null;
}

// Validate RSS feed by fetching and checking content
async function validateRssFeed(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000); // 15 second timeout

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; FeedValidator/1.0)',
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
      },
      redirect: 'follow',
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
    if (error.name === 'AbortError') {
      return { isValid: false, error: 'Timeout (15s)' };
    }
    return { isValid: false, error: error.message };
  }
}

async function main() {
  const CLOUDFLARE_API_TOKEN = loadApiToken();
  const accountId = '6034f1c5d23e5503f6573740480cf0d6';
  const databaseId = '8ae08ec3-59d5-41f3-a433-d8635fd31931';

  if (!CLOUDFLARE_API_TOKEN) {
    console.error('❌ CLOUDFLARE_API_TOKEN not found in .dev.vars');
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
    const error = await response.text();
    console.error(error);
    process.exit(1);
  }

  const result = await response.json();
  const feeds = result.result[0].results || [];

  console.log(`Found ${feeds.length} total feeds\n`);
  console.log('🔄 Validating EVERY feed (this will take several minutes)...\n');

  const results = [];
  const startTime = Date.now();

  // Validate each feed
  for (let i = 0; i < feeds.length; i++) {
    const feed = feeds[i];
    const feedStartTime = Date.now();

    process.stdout.write(
      `[${i + 1}/${feeds.length}] Validating: ${feed.name.substring(0, 50).padEnd(50)}... `
    );

    const validation = await validateRssFeed(feed.url);
    const duration = Date.now() - feedStartTime;

    results.push({
      ...feed,
      isActive: feed.isActive === 1,
      ...validation,
      validationTime: duration,
    });

    if (validation.isValid) {
      console.log(`✅ ${validation.feedType} (${duration}ms)`);
    } else {
      console.log(`❌ ${validation.error} (${duration}ms)`);
    }

    // Small delay to avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const totalDuration = Date.now() - startTime;
  console.log(`\n\n⏱️  Total validation time: ${(totalDuration / 1000).toFixed(1)}s`);

  console.log('\n📊 Validation Results:\n');

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

  // Show ALL invalid feeds grouped by error
  console.log('❌ ALL INVALID FEEDS BY ERROR TYPE:\n');

  Object.entries(errorGroups)
    .sort((a, b) => b[1].length - a[1].length)
    .forEach(([error, feedList]) => {
      console.log(`\n${error} (${feedList.length} feeds):`);
      console.log('─'.repeat(100));
      feedList.forEach((feed) => {
        const status = feed.isActive ? '🟢 ACTIVE' : '⚪ inactive';
        console.log(`${status} ${feed.name}`);
        console.log(`     URL: ${feed.url}`);
        console.log(`     ID:  ${feed.id}`);
      });
    });

  // Show valid feed types
  console.log('\n\n✅ VALID FEEDS SUMMARY:\n');
  const rssCount = validFeeds.filter((f) => f.feedType === 'RSS').length;
  const atomCount = validFeeds.filter((f) => f.feedType === 'Atom').length;
  console.log(`RSS feeds:  ${rssCount}`);
  console.log(`Atom feeds: ${atomCount}`);

  // Save complete results
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const outputFile = `feed-validation-results-${timestamp}.json`;

  fs.writeFileSync(
    outputFile,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        validationDuration: `${(totalDuration / 1000).toFixed(1)}s`,
        summary: {
          total: feeds.length,
          valid: validFeeds.length,
          invalid: invalidFeeds.length,
          activeInvalid: activeInvalidFeeds.length,
        },
        errorBreakdown: Object.fromEntries(
          Object.entries(errorGroups).map(([error, feeds]) => [error, feeds.length])
        ),
        invalidFeeds: invalidFeeds,
        validFeeds: validFeeds.map((f) => ({
          id: f.id,
          name: f.name,
          url: f.url,
          feedType: f.feedType,
          isActive: f.isActive,
        })),
      },
      null,
      2
    )
  );

  console.log(`\n💾 Complete results saved to: ${outputFile}`);
  console.log('\n✨ Validation complete!');
}

main().catch(console.error);
