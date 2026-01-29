# AGENTS.md

Guidelines for AI agents working on the Briefings codebase.

## Commands

```bash
# Development
pnpm dev                    # Start dev server with wrangler
pnpm tail                   # View real-time production logs

# Database
pnpm db:migrate             # Apply migrations to remote D1
pnpm sync:feeds             # Sync feeds from config/feeds.yaml to D1

# Testing
pnpm test                   # Run all tests with vitest
pnpm test:watch             # Run tests in watch mode
pnpm test:coverage          # Run tests with coverage report
# Run a single test file:
pnpm vitest run src/services/summarization/summarization-service.test.ts
# Run tests matching a pattern:
pnpm vitest run -t "should generate daily summary"

# Type Checking & Linting
pnpm typecheck              # TypeScript type checking (tsc --noEmit)

# Deployment
pnpm deploy                 # Deploy to Cloudflare Workers
```

## Architecture

Hono-based Cloudflare Worker with queue-based pipeline for RSS summarization.

**Entry Points** (`src/index.ts`):
- `fetch` - HTTP routes via Hono
- `scheduled` - Cron jobs (feed fetch, daily summary, weekly digest)
- `queue` - Queue message handlers

**Queue Pipeline** (4 queues):
1. `briefings-feed-fetch` → Parses RSS → D1 (articles)
2. `briefings-daily-summary-initiator` → Queues for processing
3. `briefings-daily-summary-processor` → Gemini API → D1 (summaries)
4. `briefings-weekly-digest` → Aggregates → R2 + Email

**Key Services**:
- `src/lib/gemini.ts` - Gemini API client
- `src/services/summarization/summarization-service.ts` - Core AI logic
- `src/services/feed/feed-service.ts` - RSS parsing
- `src/lib/email.ts` - Resend integration
- `src/lib/r2.ts` - Historical storage

## Code Style Guidelines

### Imports
- Use ES modules (`"type": "module"` in package.json)
- Order: external deps → internal modules → types
- Use `.js` extensions for local imports (Node ESM requirement)
- Example: `import { setupDb } from './db.js';`

### Formatting
- No explicit linter configured - follow existing patterns
- Use single quotes for strings
- 2-space indentation
- Semicolons required
- Max line length: ~100 characters

### Types & Naming
- TypeScript with strict mode **disabled** (see tsconfig.json)
- Use `PascalCase` for: types, interfaces, classes, enums
- Use `camelCase` for: variables, functions, methods, properties
- Use `UPPER_SNAKE_CASE` for: constants, env vars
- Use `kebab-case` for: file names
- Prefix interfaces with `I` (e.g., `IGeminiClient`)
- Suffix types with `Type` when needed (e.g., `PromptType`)

### Error Handling
- Use custom error classes from `src/lib/errors.ts`
- Always log errors with context using `logger.error()`
- Throw `ApiError` for API failures with proper `ErrorCode`
- Use `try/catch` in queue handlers and ack/retry appropriately

### Database
- Use Kysely (type-safe SQL builder)
- Call `setupDb(env)` before any DB operations
- Use helper functions: `toTimestamp()`, `fromTimestamp()`
- Define types in `src/db/types.ts`

### Queue Handlers
- Always call `message.ack()` on success
- Call `message.retry()` only for transient failures
- Use `isRetryableError()` to determine retry logic
- Log at start and end of processing

### API Keys & Security
- Use `requireApiKey` middleware for mutating endpoints
- Use `checkApiKey` for read-only endpoints
- Never log API keys or secrets
- Store secrets in Wrangler (not in code)

### AI/Prompts
- Models defined in `src/lib/constants.ts`
- Prompts loaded from `config/prompts.yaml`
- Use `thinkingLevel` config for Gemini 3 (LOW/MEDIUM/HIGH)
- Temperature 1.0 for creative tasks, 0.7 for factual

### Testing
- Use Vitest with globals enabled
- Mock external APIs (Gemini, Resend, R2)
- Reset mocks between tests in `test/setup.ts`
- Use `createMockBatch()` utility for queue tests

## Key Conventions

1. **Always await DB setup**: `await setupDb(env)` in handlers
2. **Use type imports**: `import type { Foo } from './types.js'`
3. **Log context**: Include relevant IDs, dates, counts in logs
4. **Handle timeouts**: Gemini API can be slow - use retries
5. **Validate inputs**: Use Zod schemas for external data
6. **Keep services focused**: One responsibility per service
7. **Use XML tags in prompts**: Better model adherence

## Project Structure

```
src/
├── index.ts                 # Worker entry point
├── db.ts                    # D1/Kysely setup
├── db/
│   ├── types.ts            # Database types
│   └── helpers.ts          # Timestamp helpers
├── lib/
│   ├── constants.ts        # Model configs
│   ├── gemini.ts           # AI client
│   ├── email.ts            # Resend service
│   ├── r2.ts               # Storage service
│   ├── logger.ts           # Logging utility
│   ├── errors.ts           # Error classes
│   ├── prompts.ts          # Prompt loader
│   └── config.ts           # YAML config parser
├── services/
│   ├── summarization/      # AI summarization logic
│   ├── feed/               # RSS parsing
│   └── interfaces.ts       # Service interfaces
├── server-functions/
│   ├── crons/              # Cron job handlers
│   ├── queues/             # Queue consumers
│   ├── http/               # HTTP endpoints
│   └── utils/              # Queue dispatcher
├── types/
│   └── env.d.ts            # Cloudflare bindings
└── scripts/
    └── sync-feeds.ts       # Feed sync CLI
```

## Environment & Bindings

Key env vars (see `src/types/env.d.ts`):
- `DB` - D1 database
- `BRIEFINGS_CONFIG_KV` - KV namespace
- `briefings_md_output` - R2 bucket
- `GEMINI_API_KEY`, `RESEND_API_KEY` - API keys
- `EMAIL_FROM`, `EMAIL_TO` - Email config

## Common Tasks

**Add a new HTTP endpoint**:
1. Create handler in `src/server-functions/http/`
2. Import in `src/index.ts`
3. Add route with appropriate middleware
4. Update README.md

**Add a queue consumer**:
1. Create file in `src/server-functions/queues/`
2. Export `queue` function
3. Add to handler mapping in `src/index.ts`
4. Configure in `wrangler.toml`

**Add a database migration**:
1. Create SQL file in `migrations/`
2. Run `pnpm db:migrate`
3. Update `src/db/types.ts` if schema changed

**Modify AI prompts**:
1. Edit `config/prompts.yaml`
2. Copy to `config/prompts.example.yaml`
3. Redeploy to apply changes
