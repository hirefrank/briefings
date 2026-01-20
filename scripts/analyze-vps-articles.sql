-- SQL script to analyze article counts from VPS dump
-- Run with: sqlite3 temp_vps.db < analyze-vps-articles.sql

-- First, let's see the structure
.schema articles
.schema feeds

-- Count total articles
SELECT '📊 Total Articles:' as metric, COUNT(*) as count FROM articles;

-- Articles by date (last 14 days based on created_at timestamp)
SELECT '📅 Articles by Date (Last 14 Days):' as header;
SELECT 
    DATE(datetime(created_at, 'unixepoch')) as date,
    COUNT(*) as article_count
FROM articles
WHERE created_at >= strftime('%s', 'now', '-14 days')
GROUP BY DATE(datetime(created_at, 'unixepoch'))
ORDER BY date DESC;

-- Articles by feed (last 7 days)
SELECT '' as blank;
SELECT '📰 Articles by Feed (Last 7 Days):' as header;
SELECT 
    f.name as feed_name,
    COUNT(a.id) as article_count
FROM feeds f
LEFT JOIN articles a ON f.id = a.feed_id 
    AND a.created_at >= strftime('%s', 'now', '-7 days')
GROUP BY f.id
ORDER BY article_count DESC, f.name;

-- Feed status
SELECT '' as blank;
SELECT '🏥 Feed Health Status:' as header;
SELECT 
    name,
    CASE is_active 
        WHEN 1 THEN 'Active'
        ELSE 'Inactive'
    END as status,
    error_count,
    DATE(datetime(last_fetched_at, 'unixepoch')) as last_fetch
FROM feeds
ORDER BY is_active DESC, name;

-- Export detailed data for comparison
.mode csv
.headers on
.output vps-article-counts.csv
SELECT 
    DATE(datetime(a.created_at, 'unixepoch')) as date,
    f.name as feed_name,
    COUNT(a.id) as article_count
FROM articles a
JOIN feeds f ON a.feed_id = f.id
WHERE a.created_at >= strftime('%s', 'now', '-30 days')
GROUP BY DATE(datetime(a.created_at, 'unixepoch')), f.id
ORDER BY date DESC, f.name;