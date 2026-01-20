#!/bin/bash
# Script to analyze article counts from VPS dump.sql

echo "🔍 Analyzing VPS Database Dump"
echo "=============================="
echo ""

# Extract and count articles by date from the dump
echo "📊 Extracting article data from dump.sql..."

# Find where article inserts start
ARTICLE_START=$(grep -n "INSERT INTO articles VALUES" dump.sql | head -1 | cut -d: -f1)

if [ -z "$ARTICLE_START" ]; then
    echo "❌ No article data found in dump.sql"
    exit 1
fi

# Extract article inserts and parse the data
echo "Found article data starting at line $ARTICLE_START"
echo ""

# Create a temporary SQLite database from the dump
echo "📂 Creating temporary database from dump..."
sqlite3 temp_vps.db < dump.sql 2>/dev/null

# Query the temporary database
echo "📊 Article Counts by Date (Last 14 Days):"
echo "----------------------------------------"
sqlite3 temp_vps.db << EOF
SELECT 
    DATE(datetime(created_at, 'unixepoch')) as date,
    COUNT(*) as article_count
FROM articles
WHERE created_at >= strftime('%s', 'now', '-14 days')
GROUP BY DATE(datetime(created_at, 'unixepoch'))
ORDER BY date DESC;
EOF

echo ""
echo "📊 Article Counts by Feed (Last 7 Days):"
echo "----------------------------------------"
sqlite3 temp_vps.db << EOF
SELECT 
    f.name as feed_name,
    COUNT(a.id) as article_count
FROM feeds f
LEFT JOIN articles a ON f.id = a.feed_id 
    AND a.created_at >= strftime('%s', 'now', '-7 days')
GROUP BY f.id
ORDER BY article_count DESC, f.name;
EOF

echo ""
echo "📊 Total Articles in Database:"
echo "------------------------------"
sqlite3 temp_vps.db << EOF
SELECT 
    COUNT(*) as total_articles,
    MIN(DATE(datetime(created_at, 'unixepoch'))) as earliest_date,
    MAX(DATE(datetime(created_at, 'unixepoch'))) as latest_date
FROM articles;
EOF

echo ""
echo "📊 Feed Status:"
echo "---------------"
sqlite3 temp_vps.db << EOF
SELECT 
    name,
    CASE is_active 
        WHEN 1 THEN '✅ Active'
        ELSE '❌ Inactive'
    END as status,
    error_count,
    DATE(datetime(last_fetched_at, 'unixepoch')) as last_fetch
FROM feeds
ORDER BY is_active DESC, name;
EOF

# Export detailed data for comparison
echo ""
echo "📄 Exporting detailed data for comparison..."
sqlite3 temp_vps.db << EOF > vps-article-counts.csv
.mode csv
.headers on
SELECT 
    DATE(datetime(a.created_at, 'unixepoch')) as date,
    f.name as feed_name,
    COUNT(a.id) as article_count
FROM articles a
JOIN feeds f ON a.feed_id = f.id
WHERE a.created_at >= strftime('%s', 'now', '-30 days')
GROUP BY DATE(datetime(a.created_at, 'unixepoch')), f.id
ORDER BY date DESC, f.name;
EOF

echo "✅ Exported to vps-article-counts.csv"

# Clean up
rm -f temp_vps.db

echo ""
echo "🔄 Next Steps for Comparison:"
echo "-----------------------------"
echo "1. Run ./scripts/check-article-counts.sh to get Cloudflare data"
echo "2. Compare the daily totals between VPS and Cloudflare"
echo "3. Check vps-article-counts.csv vs article-counts-detail.csv"
echo "4. Look for missing feeds or significant count differences"