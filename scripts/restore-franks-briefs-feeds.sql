-- Restore feeds to Frank's briefs weekly summary

-- First check if Frank's briefs exists and get its feed group ID
SELECT id, name, feedGroupId FROM WeeklySummaryInstance WHERE name = 'Frank''s Briefs';

-- Add all active feeds back to Frank's briefs
INSERT INTO FeedGroupFeed (feedGroupId, feedId)
SELECT 
    (SELECT feedGroupId FROM WeeklySummaryInstance WHERE name = 'Frank''s Briefs'),
    f.id
FROM Feed f
WHERE f.isActive = 1
AND NOT EXISTS (
    SELECT 1 FROM FeedGroupFeed fgf 
    WHERE fgf.feedGroupId = (SELECT feedGroupId FROM WeeklySummaryInstance WHERE name = 'Frank''s Briefs')
    AND fgf.feedId = f.id
);

-- Verify the restoration
SELECT COUNT(*) as restored_feeds 
FROM FeedGroupFeed 
WHERE feedGroupId = (SELECT feedGroupId FROM WeeklySummaryInstance WHERE name = 'Frank''s Briefs');