# Admin App Integration for Feed Groups

This document outlines how to update the admin app to support the new feed
groups functionality in the Briefings app.

## Required Admin Features

### 1. Feed Groups Management

Create a new section in the admin app for managing feed groups:

#### Feed Groups List Page

- Display all feed groups in a table
- Show: Name, Slug, Description, Feed Count, Contact Count
- Actions: Create New, Edit, Delete, View Feeds

#### Create/Edit Feed Group Form

```typescript
interface FeedGroupForm {
  name: string; // Display name
  slug: string; // URL-safe identifier (auto-generated from name)
  description?: string; // Optional description
  contactProperties: Array<{
    // Loops contact properties
    name: string; // e.g., "email", "user_group"
    value: string; // e.g., "digest@example.com", "premium"
  }>;
}
```

#### Assign Feeds to Groups

- Multi-select interface to assign feeds to groups
- Bulk operations support
- Show current group assignments

### 2. Weekly Summary Enhancements

Update the weekly summary trigger interface:

```typescript
interface WeeklySummaryTrigger {
  weekStartDate?: string; // Optional custom date range
  weekEndDate?: string;
  feedGroupId?: string; // NEW: Optional feed group filter
  force?: boolean; // Force regeneration
}
```

Add a dropdown to select feed group when triggering weekly summaries:

- "All Feeds" (default) - no feedGroupId
- List of available feed groups

### 3. Database Queries

#### Get All Feed Groups

```typescript
const feedGroups = await db
  .select({
    ...feedGroups,
    feedCount: sql`COUNT(DISTINCT ${feedGroupFeeds.feedId})`.as('feedCount'),
  })
  .from(feedGroups)
  .leftJoin(feedGroupFeeds, eq(feedGroups.id, feedGroupFeeds.feedGroupId))
  .groupBy(feedGroups.id);
```

#### Get Feeds for a Group

```typescript
const feeds = await db
  .select()
  .from(feeds)
  .innerJoin(feedGroupFeeds, eq(feeds.id, feedGroupFeeds.feedId))
  .where(eq(feedGroupFeeds.feedGroupId, groupId));
```

#### Create Feed Group

```typescript
const newGroup = await db
  .insert(feedGroups)
  .values({
    id: crypto.randomUUID(),
    name: formData.name,
    slug: formData.slug,
    description: formData.description,
    contactProperties: JSON.stringify(formData.contactProperties),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  })
  .returning();
```

#### Assign Feeds to Group

```typescript
// Remove existing assignments
await db.delete(feedGroupFeeds).where(eq(feedGroupFeeds.feedGroupId, groupId));

// Add new assignments
const assignments = feedIds.map((feedId) => ({
  feedGroupId: groupId,
  feedId: feedId,
}));

await db.insert(feedGroupFeeds).values(assignments);
```

### 4. UI Components

#### Feed Group Selector Component

```tsx
export function FeedGroupSelector({
  value,
  onChange,
}: {
  value?: string;
  onChange: (groupId?: string) => void;
}) {
  const feedGroups = useFeedGroups();

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue placeholder="All Feeds" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="">All Feeds</SelectItem>
        {feedGroups.map((group) => (
          <SelectItem key={group.id} value={group.id}>
            {group.name} ({group.feedCount} feeds)
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
```

#### Contact Properties Editor

```tsx
export function ContactPropertiesEditor({
  value,
  onChange,
}: {
  value: Array<{ name: string; value: string }>;
  onChange: (properties: Array<{ name: string; value: string }>) => void;
}) {
  // Implementation for adding/editing/removing contact properties
  // Common properties: email, user_group, subscription_type
}
```

### 5. API Integration

Update the weekly summary trigger to include feedGroupId:

```typescript
async function triggerWeeklySummary(params: {
  weekStartDate?: string;
  weekEndDate?: string;
  feedGroupId?: string;
  force?: boolean;
}) {
  const response = await fetch('/api/briefings/run/weekly-summary', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': API_KEY,
    },
    body: JSON.stringify(params),
  });

  return response.json();
}
```

### 6. Permissions and Validation

- Only admins can create/edit/delete feed groups
- Validate slug uniqueness
- Prevent deletion of groups with active Loops integrations
- Validate contact properties format for Loops compatibility

### 7. Monitoring and Analytics

Add dashboard widgets for:

- Number of feed groups
- Weekly summaries per group
- Loops email delivery stats (if available)
- Most active feed groups

## Migration Considerations

1. **Existing Weekly Summaries**: Continue to work without feedGroupId
2. **Gradual Adoption**: Start with one feed group as a pilot
3. **Testing**: Create a test feed group with limited feeds first

## Example Workflow

1. Admin creates a "Tech News" feed group
2. Assigns relevant tech RSS feeds to the group
3. Adds contact properties:
   `[{name: "email", value: "tech-digest@company.com"}]`
4. Triggers weekly summary with `feedGroupId` of "Tech News"
5. System generates summary only from tech feeds
6. Loops sends digest to the configured email list

## Future Enhancements

- Scheduled summaries per feed group
- Different summary templates per group
- A/B testing for digest formats
- Subscriber management UI
