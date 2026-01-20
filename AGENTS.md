# AGENTS.md

Hono-based RSS summarization engine using Gemini AI and a 12-stage queue pipeline for automated newsletters.

## STRUCTURE

```
/src
  /server-functions
    /crons      # Trigger logic for feed fetch (4h), daily (10AM UTC), weekly summary
    /queues     # Consumer handlers for the 12-stage pipeline
    /http       # Manual trigger endpoints (e.g., /run/daily-summary)
  /services     # Gemini AI client, Feed parsing, and Summarization logic
  /db.ts        # D1/Drizzle configuration
/scripts        # 39 maintenance scripts for migrations, validation, and analysis
/migrations     # 13 D1 migration files tracking schema evolution
```

## WHERE TO LOOK

| Component        | Path                                                  | Notes                                   |
| ---------------- | ----------------------------------------------------- | --------------------------------------- |
| Entry Point      | `src/index.ts`                                        | Hono app + Queue/Cron handlers          |
| Queue Dispatcher | `src/server-functions/utils/queue-dispatcher.ts`      | Centralized dispatch logic (553 lines)  |
| Summarization    | `src/services/summarization/summarization-service.ts` | **Hotspot**: Core AI logic (1071 lines) |
| Database Schema  | `src/db/schema.ts`                                    | Drizzle schema                          |
| Infrastructure   | `wrangler.toml`                                       | 12 Queues, D1, KV, and R2 bindings      |

## QUEUE ARCHITECTURE

The system uses a sequential/branching pipeline via `queue-dispatcher.ts`:

1. **Ingestion**: `briefings-feed-fetch` (Parses RSS into D1)
2. **Daily**: `initiator` → `processor` (Gemini API generation)
3. **Weekly**: `initiator` → `aggregator` → `generator` → `postprocessor` → `finalizer`
4. **Publishing**: `slack`, `lexpage`, `loops`, `r2` (Sequential triggers after generation)

## COMMANDS

```bash
pnpm dev                    # Local dev with wrangler
pnpm deploy                 # Deploy to Cloudflare production
pnpm db:migrate:remote      # Apply migrations to remote D1
pnpm db:migrate:local       # Apply migrations to local D1
pnpm db:studio              # Open Drizzle Studio
```

## NOTES

- **Refactoring Required**: `SummarizationService` and `QueueDispatcher` exceed size limits and need decomposition.
- **Data Persistence**: Primary state in D1 (`briefings-db`); output stored in R2 (`markdown-output`).
- **Configuration**: Uses `APP_CONFIG_KV` for feature flags and prompt templates.
- **Reliability**: Queue-based architecture ensures Gemini API rate limits and R2 concurrency are managed.
