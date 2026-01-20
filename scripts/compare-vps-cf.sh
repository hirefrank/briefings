#!/bin/bash
# Script to compare article counts between VPS dump and Cloudflare Workers

echo "🔄 Comparing VPS Database vs Cloudflare Workers"
echo "==============================================="
echo ""

# Step 1: Create temp database from VPS dump
echo "📂 Creating temporary database from VPS dump..."
sqlite3 temp_vps.db < dump.sql 2>/dev/null

if [ $? -ne 0 ]; then
    echo "❌ Error loading dump.sql into SQLite"
    exit 1
fi

# Step 2: Analyze VPS data
echo ""
echo "📊 VPS Database Analysis:"
echo "========================="
sqlite3 temp_vps.db << 'EOF'
.mode column
.headers on
.width 20 10

-- Total articles
SELECT 'Total Articles' as metric, COUNT(*) as count FROM articles;

-- Date range
SELECT 
    'Date Range' as metric,
    MIN(DATE(datetime(created_at, 'unixepoch'))) || ' to ' || MAX(DATE(datetime(created_at, 'unixepoch'))) as range
FROM articles;

-- Last 7 days summary
SELECT '' as blank;
SELECT 'Last 7 Days by Date:' as header;
SELECT 
    DATE(datetime(created_at, 'unixepoch')) as date,
    COUNT(*) as articles
FROM articles
WHERE created_at >= strftime('%s', 'now', '-7 days')
GROUP BY DATE(datetime(created_at, 'unixepoch'))
ORDER BY date DESC;

-- Active feeds count
SELECT '' as blank;
SELECT 'Feed Summary:' as header;
SELECT 
    CASE is_active WHEN 1 THEN 'Active' ELSE 'Inactive' END as status,
    COUNT(*) as count
FROM feeds
GROUP BY is_active;
EOF

# Step 3: Export VPS data for comparison
echo ""
echo "📄 Exporting VPS data..."
sqlite3 temp_vps.db << 'EOF' > vps-daily-counts.csv
.mode csv
.headers on
SELECT 
    DATE(datetime(created_at, 'unixepoch')) as date,
    COUNT(*) as total_articles
FROM articles
WHERE created_at >= strftime('%s', 'now', '-14 days')
GROUP BY DATE(datetime(created_at, 'unixepoch'))
ORDER BY date DESC;
EOF

sqlite3 temp_vps.db << 'EOF' > vps-feed-counts.csv
.mode csv
.headers on
SELECT 
    f.name as feed_name,
    COUNT(CASE WHEN a.created_at >= strftime('%s', 'now', '-7 days') THEN 1 END) as last_7_days,
    COUNT(CASE WHEN a.created_at >= strftime('%s', 'now', '-1 day') THEN 1 END) as last_24_hours
FROM feeds f
LEFT JOIN articles a ON f.id = a.feed_id
WHERE f.is_active = 1
GROUP BY f.id
ORDER BY f.name;
EOF

# Step 4: Get Cloudflare data
echo ""
echo "📊 Cloudflare Workers Analysis:"
echo "==============================="

# Get CF daily counts
wrangler d1 execute DB --remote --command "
SELECT 
    DATE(createdAt) as date,
    COUNT(*) as total_articles
FROM Article
WHERE createdAt >= datetime('now', '-14 days')
GROUP BY DATE(createdAt)
ORDER BY date DESC
" > cf-daily-counts.txt

# Get CF feed counts
wrangler d1 execute DB --remote --json --command "
SELECT 
    f.name as feed_name,
    COUNT(CASE WHEN a.createdAt >= datetime('now', '-7 days') THEN 1 END) as last_7_days,
    COUNT(CASE WHEN a.createdAt >= datetime('now', '-1 day') THEN 1 END) as last_24_hours
FROM Feed f
LEFT JOIN Article a ON f.id = a.feedId
WHERE f.isActive = 1
GROUP BY f.id
ORDER BY f.name
" > cf-feed-counts.json

# Step 5: Show side-by-side comparison
echo ""
echo "📊 Side-by-Side Comparison:"
echo "==========================="
echo ""
echo "Daily Totals (VPS vs CF):"
echo "-------------------------"
echo "VPS Data:"
cat vps-daily-counts.csv | column -t -s,
echo ""
echo "CF Data:"
cat cf-daily-counts.txt

echo ""
echo "📈 Summary:"
echo "-----------"
# Count VPS articles from last 24h
VPS_24H=$(sqlite3 temp_vps.db "SELECT COUNT(*) FROM articles WHERE created_at >= strftime('%s', 'now', '-1 day')")
echo "VPS articles (last 24h): $VPS_24H"

# You'll need to manually compare with CF output above
echo ""
echo "💡 Next Steps:"
echo "1. Compare the daily totals between VPS and CF"
echo "2. Check vps-feed-counts.csv vs cf-feed-counts.json"
echo "3. Look for any missing feeds or significant differences"
echo "4. Investigate any feeds showing 0 articles in CF but not VPS"

# Cleanup
rm -f temp_vps.db

echo ""
echo "✅ Analysis complete! Check the CSV files for detailed comparison."