#!/bin/bash
# Script to check article counts and compare with VPS service

echo "🔍 Briefings Article Count Analysis"
echo "==================================="
echo ""

# Check if we're in the right directory
if [ ! -f "wrangler.toml" ]; then
    echo "❌ Error: Please run this script from the apps/briefings directory"
    exit 1
fi

# Function to run a query and display results
run_query() {
    local title="$1"
    local query="$2"
    local output_format="${3:-table}"
    
    echo "$title"
    echo "----------------------------------------"
    
    if [ "$output_format" = "json" ]; then
        wrangler d1 execute DB --remote --json --command "$query"
    else
        wrangler d1 execute DB --remote --command "$query"
    fi
    
    echo ""
}

# 1. Daily article counts for the last 14 days
run_query "📊 Daily Article Counts (Last 14 Days)" "
SELECT 
    DATE(createdAt) as date,
    COUNT(*) as total_articles
FROM Article
WHERE createdAt >= datetime('now', '-14 days')
GROUP BY DATE(createdAt)
ORDER BY date DESC
"

# 2. Article counts by feed for today
run_query "📰 Today's Articles by Feed" "
SELECT 
    f.name as feed_name,
    COUNT(a.id) as article_count,
    MAX(datetime(a.createdAt)) as latest_article
FROM Feed f
LEFT JOIN Article a ON f.id = a.feedId AND DATE(a.createdAt) = DATE('now')
WHERE f.isActive = 1
GROUP BY f.id
ORDER BY article_count DESC, f.name
"

# 3. Feed health check
run_query "🏥 Feed Health Status" "
SELECT 
    name,
    CASE 
        WHEN isActive = 1 THEN '✅ Active'
        ELSE '❌ Inactive'
    END as status,
    CASE 
        WHEN lastError IS NOT NULL THEN '⚠️  ' || lastError
        ELSE '✅ No errors'
    END as last_error,
    errorCount as error_count,
    datetime(lastFetchedAt) as last_fetched
FROM Feed
ORDER BY isActive DESC, errorCount DESC, name
"

# 4. Weekly comparison
run_query "📈 Weekly Article Trends" "
SELECT 
    strftime('%Y-W%W', createdAt) as week,
    COUNT(*) as total_articles,
    COUNT(DISTINCT feedId) as active_feeds
FROM Article
WHERE createdAt >= datetime('now', '-28 days')
GROUP BY strftime('%Y-W%W', createdAt)
ORDER BY week DESC
"

# 5. Missing feeds check (feeds with no recent articles)
run_query "⚠️  Feeds with No Recent Articles (Last 24h)" "
SELECT 
    f.name,
    f.url,
    datetime(f.lastFetchedAt) as last_fetch_attempt,
    COUNT(a.id) as articles_last_7_days
FROM Feed f
LEFT JOIN Article a ON f.id = a.feedId AND a.createdAt >= datetime('now', '-7 days')
WHERE f.isActive = 1
GROUP BY f.id
HAVING COUNT(CASE WHEN a.createdAt >= datetime('now', '-24 hours') THEN 1 END) = 0
ORDER BY articles_last_7_days ASC, f.name
"

# 6. Detailed breakdown for comparison
echo "📊 Detailed Daily Breakdown by Feed (Last 7 Days)"
echo "----------------------------------------"
echo "Saving to: article-counts-detail.csv"

wrangler d1 execute DB --remote --command "
SELECT 
    DATE(a.createdAt) as date,
    f.name as feed_name,
    COUNT(a.id) as article_count
FROM Article a
JOIN Feed f ON a.feedId = f.id
WHERE a.createdAt >= datetime('now', '-7 days')
GROUP BY DATE(a.createdAt), f.id
ORDER BY date DESC, f.name
" > article-counts-detail.csv

echo ""
echo "✅ Analysis complete!"
echo ""
echo "📋 To compare with your VPS service:"
echo "1. Run similar queries on your VPS database"
echo "2. Compare the daily totals and per-feed counts"
echo "3. Check article-counts-detail.csv for detailed breakdown"
echo "4. Look for any significant discrepancies"
echo ""
echo "💡 Tip: You can also run individual queries using:"
echo "   wrangler d1 execute DB --remote --command \"YOUR_SQL_QUERY\""