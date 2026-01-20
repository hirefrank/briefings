# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
pnpm dev                    # Start local dev server with wrangler
pnpm tail                   # View real-time production logs

# Database
pnpm db:generate            # Generate Drizzle migrations from schema changes
pnpm db:migrate:local       # Apply migrations to local D1
pnpm db:migrate:remote      # Apply migrations to remote D1
pnpm db:studio              # Open Drizzle Studio GUI
pnpm db:seed                # Seed database with sample feeds

# Testing & Types
pnpm test                   # Run tests with vitest
pnpm test:watch             # Run tests in watch mode
pnpm typecheck              # TypeScript type checking

# Deployment
pnpm deploy                 # Deploy to Cloudflare Workers
```

## Architecture

This is a Hono-based Cloudflare Worker that processes RSS feeds through a queue-based pipeline to generate AI-powered daily summaries and weekly digests.

### Entry Point & Request Flow

`src/index.ts` is the unified Worker entry point that exports three handlers:

- **fetch**: HTTP requests via Hono routes
- **scheduled**: Cron jobs mapped by expression (e.g., `0 */4 * * *` → feed fetch)
- **queue**: Queue messages dispatched by queue name

### Queue Pipeline (4 queues)

```
Cron (every 4h) → briefings-feed-fetch → D1 (articles)
                           ↓
Cron (10 AM UTC) → briefings-daily-summary-initiator → briefings-daily-summary-processor → D1 (summaries)
                           ↓
Manual trigger → briefings-weekly-digest → R2 (history) + Email (Resend)
```

Queue consumers live in `src/server-functions/queues/`:
- `feed-fetch-consumer.ts` - Parses RSS feeds, stores articles
- `daily-summary-initiator.ts` - Finds unprocessed articles, queues for summarization
- `daily-summary-processor.ts` - Calls Gemini API to generate summaries
- `weekly-digest-consumer.ts` - Aggregates weekly content, generates digest, sends email

### Core Services

| Service | Location | Purpose |
|---------|----------|---------|
| Gemini Client | `src/lib/gemini.ts` | Google Gemini API wrapper for all AI operations |
| Summarization | `src/services/summarization/summarization-service.ts` | Core AI logic for summaries and digests |
| Feed Parser | `src/services/feed/feed-service.ts` | RSS parsing and article extraction |
| Email | `src/lib/email.ts` | Resend integration for digest delivery |
| R2 Storage | `src/lib/r2.ts` | Historical digest storage for context |

### Database Schema

Schema defined in `src/db/schema.ts` using Drizzle ORM:

- `feeds` - RSS feed sources with validation state
- `articles` - Fetched articles with `processed` flag
- `dailySummaries` - AI-generated daily summaries linked to feeds
- `weeklySummaries` - Weekly digest records with `sentAt` tracking
- `feedGroups` - Optional grouping of feeds
- `promptTemplates` - Customizable AI prompt storage

### Cloudflare Bindings

Defined in `src/types/env.d.ts` and configured in `wrangler.toml`:

- **DB**: D1 database (SQLite)
- **APP_CONFIG_KV**: Feature flags and configuration
- **MARKDOWN_OUTPUT_R2**: Digest history storage
- **Queues**: `FEED_FETCH_QUEUE`, `DAILY_SUMMARY_INITIATOR_QUEUE`, `DAILY_SUMMARY_PROCESSOR_QUEUE`, `WEEKLY_DIGEST_QUEUE`

### AI Model Selection

Models configured in `src/lib/constants.ts`:
- Daily summaries: `gemini-2.0-flash-exp` (fast)
- Weekly digests: `gemini-1.5-pro` (comprehensive)

Prompts defined in `src/lib/prompts.ts`.

## Key Patterns

### Database Initialization

Every handler must call `setupDb(env)` before database operations:

```typescript
import { setupDb } from './db';
await setupDb(env);
```

### API Authentication

HTTP endpoints use middleware from `src/server-functions/http/middleware.ts`:
- `requireApiKey` - Blocks unauthenticated requests
- `checkApiKey` - Sets `authenticated` variable without blocking

### Cron Expression Mapping

Crons are mapped in `src/index.ts`:
```typescript
'0 */4 * * *'  → feedFetchCron      // Every 4 hours
'0 10 * * *'   → dailySummaryCron   // 10 AM UTC
'0 6 * * *'    → validateFeedsCron  // 6 AM UTC
```

### HTTP Endpoints

- `GET/POST /run/feed-fetch` - Manual feed fetch trigger
- `GET/POST /run/daily-summary` - Manual daily summary trigger
- `GET/POST /run/weekly-summary` - Manual weekly digest trigger
- `GET /health` - Health check
- `POST /seed` - Database seeding (requires API key)
