-- Show feeds that are likely NOT valid RSS/Atom feeds
SELECT 
    CASE WHEN isActive = 1 THEN 'ACTIVE' ELSE 'inactive' END as status,
    name,
    url
FROM Feed
WHERE 
    -- Definitely not RSS patterns
    url LIKE '%.html'
    OR url LIKE '%.htm'
    OR url LIKE '%.pdf'
    OR url LIKE '%.json'
    OR url NOT LIKE 'http%'
    OR (url LIKE '%github.com%' AND url NOT LIKE '%.atom' AND url NOT LIKE '%.rss' AND url NOT LIKE '%/releases.atom' AND url NOT LIKE '%/commits/%atom')
ORDER BY isActive DESC, name
LIMIT 50;