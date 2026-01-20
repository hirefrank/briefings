#!/bin/bash
# Script to compare article counts between VPS dump and Cloudflare Workers
# Updated with correct column names from VPS database

echo "🔄 Comparing VPS Database vs Cloudflare Workers"
echo "==============================================="
echo ""

# Step 1: Create temp database from VPS dump
echo "📂 Creating temporary database from VPS dump..."
rm -f temp_vps.db
sqlite3 temp_vps.db < dump.sql 2>/dev/null

if [ $? -ne 0 ]; then
    echo "❌ Error loading dump.sql into SQLite"
    exit 1
fi

# Step 2: Analyze VPS data
echo ""
echo "📊 VPS Database Analysis:"
echo "========================="
sqlite3 -column -header temp_vps.db << 'EOF'
-- Total articles
SELECT 'Total Articles' as metric, COUNT(*) as count FROM articles;

-- Date range (using fetch_date since that's what we have)
SELECT 
    'Date Range' as metric,
    MIN(DATE(datetime(fetch_date, 'unixepoch'))) || ' to ' || MAX(DATE(datetime(fetch_date, 'unixepoch'))) as range
FROM articles;

-- Articles by publish date (last 14 days)
SELECT '';
SELECT 'Last 14 Days by Publish Date:' as header;
SELECT 
    DATE(datetime(publish_date, 'unixepoch')) as date,
    COUNT(*) as articles
FROM articles
WHERE publish_date >= strftime('%s', 'now', '-14 days')
GROUP BY DATE(datetime(publish_date, 'unixepoch'))
ORDER BY date DESC;

-- Articles by fetch date (last 7 days)
SELECT '';
SELECT 'Last 7 Days by Fetch Date:' as header;
SELECT 
    DATE(datetime(fetch_date, 'unixepoch')) as date,
    COUNT(*) as articles
FROM articles
WHERE fetch_date >= strftime('%s', 'now', '-7 days')
GROUP BY DATE(datetime(fetch_date, 'unixepoch'))
ORDER BY date DESC;

-- Active feeds count (checking which feeds have recent articles)
SELECT '';
SELECT 'Feeds with Recent Articles:' as header;
SELECT 
    f.name,
    COUNT(a.id) as articles_last_7_days
FROM feeds f
LEFT JOIN articles a ON f.id = a.feed_id 
    AND a.fetch_date >= strftime('%s', 'now', '-7 days')
GROUP BY f.id
HAVING COUNT(a.id) > 0
ORDER BY articles_last_7_days DESC;
EOF

# Step 3: Export VPS data for comparison
echo ""
echo "📄 Exporting VPS data for comparison..."

# Daily counts by fetch date
sqlite3 temp_vps.db << 'EOF' > vps-daily-counts-fetch.csv
.mode csv
.headers on
SELECT 
    DATE(datetime(fetch_date, 'unixepoch')) as date,
    COUNT(*) as total_articles
FROM articles
WHERE fetch_date >= strftime('%s', 'now', '-14 days')
GROUP BY DATE(datetime(fetch_date, 'unixepoch'))
ORDER BY date DESC;
EOF

# Daily counts by publish date
sqlite3 temp_vps.db << 'EOF' > vps-daily-counts-publish.csv
.mode csv
.headers on
SELECT 
    DATE(datetime(publish_date, 'unixepoch')) as date,
    COUNT(*) as total_articles
FROM articles
WHERE publish_date >= strftime('%s', 'now', '-14 days')
GROUP BY DATE(datetime(publish_date, 'unixepoch'))
ORDER BY date DESC;
EOF

# Feed analysis
sqlite3 temp_vps.db << 'EOF' > vps-feed-analysis.csv
.mode csv
.headers on
SELECT 
    f.name as feed_name,
    f.url as feed_url,
    COUNT(a.id) as total_articles,
    COUNT(CASE WHEN a.fetch_date >= strftime('%s', 'now', '-7 days') THEN 1 END) as fetched_last_7_days,
    COUNT(CASE WHEN a.fetch_date >= strftime('%s', 'now', '-1 day') THEN 1 END) as fetched_last_24h,
    COUNT(CASE WHEN a.publish_date >= strftime('%s', 'now', '-7 days') THEN 1 END) as published_last_7_days
FROM feeds f
LEFT JOIN articles a ON f.id = a.feed_id
GROUP BY f.id
ORDER BY f.name;
EOF

echo "✅ VPS data exported to CSV files"

# Step 4: Get Cloudflare data
echo ""
echo "📊 Getting Cloudflare Workers Data..."
echo "====================================="

# Get CF daily counts
echo ""
echo "CF Articles by Date (Last 14 days):"
wrangler d1 execute DB --remote --command "
SELECT 
    DATE(createdAt) as date,
    COUNT(*) as total_articles
FROM Article
WHERE createdAt >= datetime('now', '-14 days')
GROUP BY DATE(createdAt)
ORDER BY date DESC
"

# Save CF data for comparison
wrangler d1 execute DB --remote --json --command "
SELECT 
    DATE(createdAt) as date,
    COUNT(*) as total_articles
FROM Article
WHERE createdAt >= datetime('now', '-14 days')
GROUP BY DATE(createdAt)
ORDER BY date DESC
" > cf-daily-counts.json 2>/dev/null

# Get CF feed analysis
echo ""
echo "CF Feeds Analysis:"
wrangler d1 execute DB --remote --command "
SELECT 
    f.name as feed_name,
    COUNT(a.id) as total_articles,
    COUNT(CASE WHEN a.createdAt >= datetime('now', '-7 days') THEN 1 END) as last_7_days,
    COUNT(CASE WHEN a.createdAt >= datetime('now', '-1 day') THEN 1 END) as last_24h
FROM Feed f
LEFT JOIN Article a ON f.id = a.feedId
WHERE f.isActive = 1
GROUP BY f.id
ORDER BY total_articles DESC
LIMIT 20
"

# Save detailed CF feed data
wrangler d1 execute DB --remote --json --command "
SELECT 
    f.name as feed_name,
    f.url as feed_url,
    COUNT(a.id) as total_articles,
    COUNT(CASE WHEN a.createdAt >= datetime('now', '-7 days') THEN 1 END) as created_last_7_days,
    COUNT(CASE WHEN a.createdAt >= datetime('now', '-1 day') THEN 1 END) as created_last_24h
FROM Feed f
LEFT JOIN Article a ON f.id = a.feedId
WHERE f.isActive = 1
GROUP BY f.id
ORDER BY f.name
" > cf-feed-analysis.json 2>/dev/null

echo ""
echo "📊 Quick Comparison Summary:"
echo "============================"

# Get totals
VPS_TOTAL=$(sqlite3 temp_vps.db "SELECT COUNT(*) FROM articles")
VPS_7D_FETCH=$(sqlite3 temp_vps.db "SELECT COUNT(*) FROM articles WHERE fetch_date >= strftime('%s', 'now', '-7 days')")
VPS_24H_FETCH=$(sqlite3 temp_vps.db "SELECT COUNT(*) FROM articles WHERE fetch_date >= strftime('%s', 'now', '-1 day')")

echo "VPS Database:"
echo "  Total articles: $VPS_TOTAL"
echo "  Fetched last 7 days: $VPS_7D_FETCH"
echo "  Fetched last 24 hours: $VPS_24H_FETCH"
echo ""
echo "Cloudflare: Check the output above"

echo ""
echo "📄 Files created for detailed comparison:"
echo "  - vps-daily-counts-fetch.csv (articles by fetch date)"
echo "  - vps-daily-counts-publish.csv (articles by publish date)"
echo "  - vps-feed-analysis.csv (detailed feed breakdown)"
echo "  - cf-daily-counts.json"
echo "  - cf-feed-analysis.json"

echo ""
echo "💡 Analysis Tips:"
echo "1. Compare VPS fetch dates with CF created dates"
echo "2. Look for feeds present in VPS but missing/low in CF"
echo "3. Check if daily patterns match between services"
echo "4. Note: VPS has both publish_date and fetch_date, CF only has createdAt"

# Cleanup
rm -f temp_vps.db

echo ""
echo "✅ Analysis complete!"