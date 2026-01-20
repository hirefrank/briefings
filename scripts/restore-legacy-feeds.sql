-- Find the Legacy Weekly Summary and its feed group
SELECT id, feedGroupId FROM WeeklySummaryInstance WHERE name = 'Legacy Weekly Summary';

-- Delete existing feed associations for the Legacy Weekly Summary
-- Replace 'FEED_GROUP_ID' with the actual feedGroupId from the query above
DELETE FROM FeedGroupFeed WHERE feedGroupId = (
    SELECT feedGroupId FROM WeeklySummaryInstance WHERE name = 'Legacy Weekly Summary'
);

-- Add all active feeds to the Legacy Weekly Summary
INSERT INTO FeedGroupFeed (feedGroupId, feedId)
SELECT 
    (SELECT feedGroupId FROM WeeklySummaryInstance WHERE name = 'Legacy Weekly Summary'),
    f.id
FROM Feed f
WHERE f.isActive = 1;

-- Verify the results
SELECT f.name, f.url 
FROM Feed f
INNER JOIN FeedGroupFeed fgf ON f.id = fgf.feedId
WHERE fgf.feedGroupId = (
    SELECT feedGroupId FROM WeeklySummaryInstance WHERE name = 'Legacy Weekly Summary'
)
ORDER BY f.name;