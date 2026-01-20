#!/usr/bin/env tsx
/**
 * Script to analyze article counts by day and by feed
 * Useful for comparing with the older VPS service to ensure proper fetching
 */

// This script provides SQL commands for manual execution
// Database imports removed as they're not needed for command generation

async function analyzeArticleCounts() {
  console.log('🔍 Analyzing article counts in Briefings database...\n');

  // SQL query to get article counts by day and feed
  const query = `
    SELECT 
      DATE(a.createdAt) as date,
      f.name as feedName,
      f.url as feedUrl,
      COUNT(a.id) as articleCount
    FROM Article a
    JOIN Feed f ON a.feedId = f.id
    GROUP BY DATE(a.createdAt), f.id
    ORDER BY date DESC, articleCount DESC
  `;

  console.log('📊 Article Counts by Day and Feed:');
  console.log('=====================================\n');

  // Run the query using wrangler
  const command = `wrangler d1 execute DB --remote --json --command "${query}"`;

  console.log('Running query...\n');
  console.log(`Command: ${command}\n`);
  console.log('To run this analysis:');
  console.log('1. Copy the command above');
  console.log('2. Run it in your terminal');
  console.log('3. The results will show article counts grouped by date and feed\n');

  // Also provide a summary query
  const summaryQuery = `
    SELECT 
      DATE(createdAt) as date,
      COUNT(*) as totalArticles
    FROM Article
    GROUP BY DATE(createdAt)
    ORDER BY date DESC
    LIMIT 30
  `;

  console.log('\n📊 Daily Article Totals (Last 30 days):');
  console.log('======================================\n');
  console.log(
    `Summary command: wrangler d1 execute DB --remote --json --command "${summaryQuery}"\n`
  );

  // Query for feeds with their last fetch info
  const feedStatusQuery = `
    SELECT 
      f.name,
      f.url,
      f.isActive,
      datetime(f.lastFetchedAt) as lastFetchedAt,
      f.errorCount,
      f.lastError,
      COUNT(a.id) as totalArticles,
      COUNT(CASE WHEN DATE(a.createdAt) = DATE('now') THEN 1 END) as articlesToday,
      COUNT(CASE WHEN DATE(a.createdAt) >= DATE('now', '-7 days') THEN 1 END) as articlesLastWeek
    FROM Feed f
    LEFT JOIN Article a ON f.id = a.feedId
    GROUP BY f.id
    ORDER BY f.name
  `;

  console.log('\n📊 Feed Status and Article Counts:');
  console.log('==================================\n');
  console.log(
    `Feed status command: wrangler d1 execute DB --remote --json --command "${feedStatusQuery}"\n`
  );

  // Query for recent articles
  const recentArticlesQuery = `
    SELECT 
      a.title,
      f.name as feedName,
      datetime(a.createdAt) as createdAt,
      a.processed
    FROM Article a
    JOIN Feed f ON a.feedId = f.id
    ORDER BY a.createdAt DESC
    LIMIT 20
  `;

  console.log('\n📊 Most Recent Articles:');
  console.log('========================\n');
  console.log(
    `Recent articles command: wrangler d1 execute DB --remote --json --command "${recentArticlesQuery}"\n`
  );

  // Provide a comparison helper
  console.log('\n🔄 For VPS Comparison:');
  console.log('======================\n');
  console.log('To compare with your VPS service:');
  console.log('1. Run these queries on both the Cloudflare D1 database and your VPS database');
  console.log('2. Compare the daily article counts to ensure they match');
  console.log('3. Check if all feeds are being fetched properly');
  console.log('4. Look for any missing articles or feeds\n');

  // Hourly breakdown for today
  const hourlyQuery = `
    SELECT 
      strftime('%Y-%m-%d %H:00', createdAt) as hour,
      COUNT(*) as articleCount,
      GROUP_CONCAT(DISTINCT f.name) as feeds
    FROM Article a
    JOIN Feed f ON a.feedId = f.id
    WHERE DATE(a.createdAt) = DATE('now')
    GROUP BY strftime('%Y-%m-%d %H:00', createdAt)
    ORDER BY hour DESC
  `;

  console.log("\n📊 Today's Articles by Hour:");
  console.log('============================\n');
  console.log(
    `Hourly breakdown command: wrangler d1 execute DB --remote --json --command "${hourlyQuery}"\n`
  );

  // Create a CSV export query
  const csvExportQuery = `
    SELECT 
      DATE(a.createdAt) as date,
      f.name as feed_name,
      COUNT(a.id) as article_count
    FROM Article a
    JOIN Feed f ON a.feedId = f.id
    WHERE a.createdAt >= datetime('now', '-30 days')
    GROUP BY DATE(a.createdAt), f.id
    ORDER BY date DESC, f.name
  `;

  console.log('\n📊 Export Last 30 Days (CSV format):');
  console.log('====================================\n');
  console.log(
    `Export command: wrangler d1 execute DB --remote --command "${csvExportQuery}" > article-counts.csv\n`
  );
}

// Helper script to format the results
console.log(`
📝 Helper Script to Format Results:
==================================

After running the queries, you can use this Node.js script to format the JSON output:

\`\`\`javascript
// format-results.js
const fs = require('fs');

// Read the JSON output from wrangler
const data = JSON.parse(fs.readFileSync('results.json', 'utf8'));

// Format by day
const byDay = {};
data.results.forEach(row => {
  const date = row.date;
  if (!byDay[date]) {
    byDay[date] = { total: 0, feeds: {} };
  }
  byDay[date].total += row.articleCount;
  byDay[date].feeds[row.feedName] = row.articleCount;
});

// Print formatted results
Object.entries(byDay)
  .sort(([a], [b]) => b.localeCompare(a))
  .forEach(([date, info]) => {
    console.log(\`\\n\${date}: \${info.total} articles\`);
    Object.entries(info.feeds)
      .sort(([, a], [, b]) => b - a)
      .forEach(([feed, count]) => {
        console.log(\`  - \${feed}: \${count}\`);
      });
  });
\`\`\`

Save the wrangler output with: wrangler d1 execute DB --remote --json --command "QUERY" > results.json
Then run: node format-results.js
`);

// Main execution
if (import.meta.url === `file://${process.argv[1]}`) {
  analyzeArticleCounts().catch(console.error);
}
