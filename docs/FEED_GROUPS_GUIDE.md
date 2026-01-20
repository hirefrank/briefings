# Feed Groups Guide

## Overview

Feed groups allow you to organize RSS feeds into collections for targeted weekly
summaries and email digests. Each feed group can have its own publishing
settings and contact lists.

## Current Status

⚠️ **Note**: Feed group management UI is not yet implemented in the admin
interface. You need to use direct database commands for now.

## How to Add Feed Groups

### Step 1: List Available Feeds

First, get the IDs of feeds you want to group:

```bash
cd apps/briefings
wrangler d1 execute briefings-db --remote --command="SELECT id, name, category FROM Feed WHERE active = 1 ORDER BY name;"
```

### Step 2: Create a Feed Group

Use this SQL command to create a new feed group:

```sql
-- Create a feed group for tech news
INSERT INTO FeedGroup (
  id,
  name,
  description,
  loopsEnabled,  -- Enable email digests
  lexEnabled,    -- Enable Lex.page publishing
  r2Enabled,     -- Enable R2 storage
  createdAt,
  updatedAt
) VALUES (
  lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6))),
  'Tech News',
  'Technology and developer focused feeds',
  1,  -- Enable Loops
  1,  -- Enable Lex
  1,  -- Enable R2
  datetime('now'),
  datetime('now')
);
```

Run it with:

```bash
wrangler d1 execute briefings-db --remote --command="<SQL above>"
```

### Step 3: Get the Group ID

Find your newly created group:

```bash
wrangler d1 execute briefings-db --remote --command="SELECT id, name FROM FeedGroup ORDER BY createdAt DESC LIMIT 1;"
```

### Step 4: Add Feeds to the Group

Add feeds using their IDs and the group ID:

```sql
-- Add multiple feeds to a group
INSERT INTO FeedGroupFeed (feedGroupId, feedId) VALUES
  ('your-group-id', 'feed-id-1'),
  ('your-group-id', 'feed-id-2'),
  ('your-group-id', 'feed-id-3');
```

### Step 5: Configure Loops Contacts (For Email Digests)

For Loops email digests, you need to set contact properties in the feed group:

```sql
UPDATE FeedGroup
SET contactProperties = '[
  {"name": "email", "value": "user1@example.com"},
  {"name": "email", "value": "user2@example.com"}
]'
WHERE id = 'your-group-id';
```

## Example: Complete Setup

Here's a full example to create a "Developer News" feed group:

```bash
# 1. Create the group (save the ID from the output)
wrangler d1 execute briefings-db --remote --command="
INSERT INTO FeedGroup (id, name, description, loopsEnabled, lexEnabled, r2Enabled, createdAt, updatedAt)
VALUES (
  lower(hex(randomblob(16))),
  'Developer News',
  'Programming and development feeds',
  1, 1, 1,
  datetime('now'),
  datetime('now')
);"

# 2. Get the group ID
wrangler d1 execute briefings-db --remote --command="
SELECT id, name FROM FeedGroup WHERE name = 'Developer News';"

# 3. Add feeds (replace with actual IDs)
wrangler d1 execute briefings-db --remote --command="
INSERT INTO FeedGroupFeed (feedGroupId, feedId) VALUES
  ('your-group-id', 'feed-id-1'),
  ('your-group-id', 'feed-id-2');"
```

## Using Feed Groups

### Weekly Summaries with Feed Groups

Once you have feed groups set up, you can generate weekly summaries for specific
groups:

```bash
# Generate weekly summary for a specific feed group
curl -X POST https://briefings.workers.dev/run/weekly-summary \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "feedGroupId": "your-group-id",
    "force": true
  }'
```

### Viewing Feed Groups

List all feed groups and their feeds:

```bash
wrangler d1 execute briefings-db --remote --command="
SELECT
  fg.id,
  fg.name as group_name,
  fg.description,
  fg.loopsEnabled,
  GROUP_CONCAT(f.name) as feeds
FROM FeedGroup fg
LEFT JOIN FeedGroupFeed fgf ON fg.id = fgf.feedGroupId
LEFT JOIN Feed f ON fgf.feedId = f.id
GROUP BY fg.id, fg.name, fg.description, fg.loopsEnabled
ORDER BY fg.name;"
```

## Contact Properties Schema

For Loops email integration, contact properties should follow this format:

```json
[
  {
    "name": "email",
    "value": "subscriber@example.com"
  },
  {
    "name": "firstName",
    "value": "John"
  },
  {
    "name": "customProperty",
    "value": "customValue"
  }
]
```

## Future Improvements

- [ ] Admin UI for feed group management
- [ ] Bulk feed assignment interface
- [ ] Contact list management UI
- [ ] Feed group analytics
- [ ] Custom prompt templates per group

## Troubleshooting

### Common Issues

1. **"UNIQUE constraint failed"**: You're trying to add a feed to a group twice.
   Use `INSERT OR IGNORE` instead.

2. **"FOREIGN KEY constraint failed"**: The feed ID or group ID doesn't exist.
   Verify the IDs first.

3. **Weekly summaries not filtering by group**: Make sure you're passing
   `feedGroupId` in the API request.

### Debug Commands

```bash
# Check if a feed group exists
wrangler d1 execute briefings-db --remote --command="SELECT * FROM FeedGroup WHERE id = 'your-group-id';"

# See which feeds are in a group
wrangler d1 execute briefings-db --remote --command="
SELECT f.id, f.name
FROM Feed f
JOIN FeedGroupFeed fgf ON f.id = fgf.feedId
WHERE fgf.feedGroupId = 'your-group-id';"

# Check feed group configuration
wrangler d1 execute briefings-db --remote --command="
SELECT name, loopsEnabled, lexEnabled, contactProperties
FROM FeedGroup;"
```
