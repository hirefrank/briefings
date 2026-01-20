-- Check for potentially invalid RSS feeds based on URL patterns
-- This is a quick check - actual validation requires fetching the feeds

-- Count feeds by URL patterns
SELECT 
    CASE 
        WHEN url LIKE '%.rss' THEN 'Likely RSS (.rss extension)'
        WHEN url LIKE '%.xml' THEN 'Likely RSS/Atom (.xml extension)'
        WHEN url LIKE '%/feed' OR url LIKE '%/feed/' THEN 'Likely RSS (/feed path)'
        WHEN url LIKE '%/rss' OR url LIKE '%/rss/' THEN 'Likely RSS (/rss path)'
        WHEN url LIKE '%/atom' OR url LIKE '%/atom/' THEN 'Likely Atom (/atom path)'
        WHEN url LIKE '%.atom' THEN 'Likely Atom (.atom extension)'
        WHEN url LIKE '%feeds.%' THEN 'Likely RSS (feeds subdomain)'
        WHEN url LIKE 'https://github.com/%' AND url NOT LIKE '%.atom' AND url NOT LIKE '%.rss' THEN 'GitHub (possibly not RSS)'
        WHEN url LIKE '%.html' OR url LIKE '%.htm' THEN 'HTML page (likely not RSS)'
        WHEN url LIKE '%.pdf' THEN 'PDF file (not RSS)'
        WHEN url LIKE '%.json' THEN 'JSON file (not RSS)'
        WHEN url NOT LIKE 'http%' THEN 'Invalid protocol'
        ELSE 'Unknown pattern - needs validation'
    END as feed_type,
    COUNT(*) as count,
    GROUP_CONCAT(CASE WHEN isActive = 1 THEN '🟢' ELSE '⚪' END || ' ' || name || ' (' || url || ')', '\n') as feeds
FROM Feed
GROUP BY feed_type
ORDER BY count DESC;

-- Show all feeds that don't match typical RSS patterns
SELECT 
    CASE WHEN isActive = 1 THEN '🟢 ACTIVE' ELSE '⚪ inactive' END as status,
    name,
    url,
    id
FROM Feed
WHERE 
    -- Not typical RSS/Atom patterns
    url NOT LIKE '%.rss'
    AND url NOT LIKE '%.xml'
    AND url NOT LIKE '%/feed'
    AND url NOT LIKE '%/feed/'
    AND url NOT LIKE '%/rss'
    AND url NOT LIKE '%/rss/'
    AND url NOT LIKE '%/atom'
    AND url NOT LIKE '%/atom/'
    AND url NOT LIKE '%.atom'
    AND url NOT LIKE '%feeds.%'
    -- Likely problematic patterns
    AND (
        url LIKE '%.html'
        OR url LIKE '%.htm'
        OR url LIKE '%.pdf'
        OR url LIKE '%.json'
        OR url NOT LIKE 'http%'
        OR url LIKE 'https://github.com/%' AND url NOT LIKE '%.atom' AND url NOT LIKE '%.rss'
    )
ORDER BY isActive DESC, name;

-- Count of active vs inactive feeds
SELECT 
    CASE WHEN isActive = 1 THEN 'Active' ELSE 'Inactive' END as status,
    COUNT(*) as count
FROM Feed
GROUP BY isActive;