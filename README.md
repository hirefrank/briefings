# Briefings

> An automated RSS feed summarization system powered by AI. Fetch articles from RSS feeds, generate daily summaries, and create weekly digest newsletters—all running on Cloudflare Workers.

## Features

- 📰 **RSS Feed Aggregation** - Automatically fetch articles from configured RSS feeds every 4 hours
- 🤖 **AI-Powered Summaries** - Generate daily summaries using Google Gemini (Flash model)
- 📧 **Weekly Digest Newsletter** - Compile weekly recaps with AI-generated insights (Gemini Pro model)
- ☁️ **Cloudflare Workers** - Serverless, edge-deployed with queue-based processing
- 💾 **D1 Database** - SQLite-based storage for articles, feeds, and summaries
- 📦 **R2 Storage** - Historical digest context for improved AI generation
- ✉️ **Email Delivery** - Optional Resend integration for automated newsletter sending

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            Briefings System                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌────────────┐ │
│  │  Cron Jobs  │────▶│  Feed Fetch │────▶│   D1 DB     │     │            │ │
│  │  (Triggers) │     │   Queue     │     │ (Articles)  │     │            │ │
│  └─────────────┘     └──────┬──────┘     └─────────────┘     │   Gemini   │ │
│                             │                               │    API      │ │
│  ┌─────────────┐            │                               │            │ │
│  │ HTTP API    │────────────┤                               │            │ │
│  │ /api/*      │            │                               └────────────┘ │
│  └─────────────┘            │                                       ▲      │
│                             ▼                                       │      │
│                    ┌───────────────┐                                │      │
│                    │ Daily Summary │                                │      │
│                    │ Initiator     │                                │      │
│                    └───────┬───────┘                                │      │
│                            │                                        │      │
│                            ▼                                        │      │
│                    ┌───────────────┐      ┌─────────────┐           │      │
│                    │ Daily Summary │─────▶│   D1 DB     │           │      │
│                    │ Processor     │      │(Summaries)  │           │      │
│                    └───────────────┘      └─────────────┘           │      │
│                                                                  ┌────┴────┐ │
│  ┌─────────────┐          ┌───────────────┐                      │         │ │
│  │ HTTP API    │─────────▶│ Weekly Digest │─────────────────────▶│ R2      │ │
│  │ /api/*      │          │ Consumer      │                      │ Storage │ │
│  └─────────────┘          └───────┬───────┘                      │         │ │
│                                   │                              │         │ │
│                                   ▼                              │         │ │
│                          ┌───────────────┐                       │         │ │
│                          │   Resend      │◀──────────────────────┘         │ │
│                          │   (Email)     │                                  │ │
│                          └───────────────┘                                  │ │
│                                                                              │ │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                         Cloudflare Bindings                             │ │
│  │  • DB: D1 Database           • KV: BRIEFINGS_CONFIG_KV                        │ │
│  │  • R2: MARKDOWN_OUTPUT_R2    • Queues: 4 queue consumers                │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Queue Pipeline

| Queue | Consumer | Batch Size | Purpose |
|-------|----------|------------|---------|
| `briefings-feed-fetch` | `feed-fetch-consumer.ts` | 10 | Parse RSS feeds, store articles |
| `briefings-daily-summary-initiator` | `daily-summary-initiator.ts` | 1 | Find unprocessed articles, fan out |
| `briefings-daily-summary-processor` | `daily-summary-processor.ts` | 5 | Call Gemini API, save summaries |
| `briefings-weekly-digest` | `weekly-digest-consumer.ts` | 1 | Aggregate, generate digest, email |

### Scheduled Triggers

| Expression | Handler | Purpose |
|------------|---------|---------|
| `0 */4 * * *` | Feed fetch | Fetch all active RSS feeds every 4 hours |
| `0 10 * * *` | Daily summary | Generate summaries for yesterday at 10 AM UTC |
| `0 6 * * *` | Feed validation | Validate feed URLs are reachable |

### Key Components

#### Entry Point

`src/index.ts` exports three Cloudflare Worker handlers:

- **fetch** -- Hono HTTP routes under `/api/*`
- **scheduled** -- Cron jobs mapped by expression
- **queue** -- Queue messages dispatched by queue name

#### HTTP API

All routes under `/api` prefix. Authentication via `X-API-Key` header.

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `GET /api/health` | None | Health check |
| `GET/POST /api/run/feed-fetch` | Required | Manual feed fetch |
| `GET/POST /api/run/daily-summary` | Required | Manual daily summary |
| `GET/POST /api/run/weekly-summary` | Required | Manual weekly digest |
| `POST /api/seed` | Required | Database seeding |
| `GET /api/test/previous-context` | Required | Dev testing |

#### Core Services

| Service | Location | Purpose |
|---------|----------|---------|
| Feed Service | `src/services/feed/feed-service.ts` | RSS parsing and article extraction |
| Summarization | `src/services/summarization/summarization-service.ts` | AI summary and digest generation |
| Gemini Client | `src/lib/gemini.ts` | Google Gemini API wrapper |
| Email | `src/lib/email.ts` | Resend integration for digest delivery |
| R2 Storage | `src/lib/r2.ts` | Historical digest storage for context |

#### AI Models

Configured in `src/lib/constants.ts`:

- **Daily summaries**: `gemini-2.5-flash` (fast, efficient)
- **Weekly digests**: `gemini-2.5-pro` (comprehensive analysis)

### Storage

#### D1 Database (Kysely ORM)

Schema defined in `src/db/types.ts`:

- `Feed` - RSS feed sources with validation state
- `Article` - Fetched articles with `processed` flag
- `DailySummary` - AI-generated daily summaries linked to feeds
- `WeeklySummary` - Weekly digest records with `sentAt` tracking
- `ArticleSummaryRelation` - Links articles to daily summaries
- `DailyWeeklySummaryRelation` - Links daily summaries to weekly summaries
- `PromptTemplate` - Customizable AI prompt storage

#### KV Namespace

`BRIEFINGS_CONFIG_KV` for feature flags and configuration.

#### R2 Bucket

`MARKDOWN_OUTPUT_R2` for storing digest history, used as context for future digests.

### Cloudflare Bindings

Defined in `src/types/env.d.ts`, configured in `wrangler.toml`:

- **DB**: D1 database
- **BRIEFINGS_CONFIG_KV**: KV namespace
- **MARKDOWN_OUTPUT_R2**: R2 bucket
- **Queues**: `FEED_FETCH_QUEUE`, `DAILY_SUMMARY_INITIATOR_QUEUE`, `DAILY_SUMMARY_PROCESSOR_QUEUE`, `WEEKLY_DIGEST_QUEUE`

### Security

- API key authentication on all mutating and operational endpoints
- Timing-safe key comparison to prevent timing attacks
- Secrets managed via Wrangler (`wrangler secret put`)
- No direct database exposure
- Input validation at all boundaries

### Technical Decisions

**Why Cloudflare Workers?**

- Edge deployment for global availability
- Integrated ecosystem (D1, KV, R2, Queues)
- Cost-effective for scheduled workloads
- Built-in scalability

**Why Queue-Based Architecture?**

- Resilience through retries
- Distributed processing within Worker CPU limits
- Clear separation of concerns
- Fan-out pattern for per-feed processing

**Why D1 + Kysely?**

- Native Workers integration
- SQLite compatibility
- Type-safe schema with Kysely ORM
- Cost-effective for read-heavy workloads

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 8+
- [Cloudflare account](https://dash.cloudflare.com/sign-up)
- [Google Gemini API key](https://aistudio.google.com/app/apikey)
- (Optional) [Resend account](https://resend.com) for email delivery

### Installation

```bash
# Clone the repository
git clone git@github.com:hirefrank/briefings.git
cd briefings

# Install dependencies
pnpm install

# Copy example files
cp wrangler.example.toml wrangler.toml
cp .env.example .env

# Edit .env and wrangler.toml with your values (see Configuration below)
```

### Configuration

#### 1. Create Cloudflare Resources

```bash
# Create D1 database
npx wrangler d1 create briefings-db
# Copy the database_id to wrangler.toml

# Create KV namespace
npx wrangler kv namespace create BRIEFINGS_CONFIG_KV
# Copy the id to wrangler.toml

# Create R2 bucket
npx wrangler r2 bucket create briefings-md-output
```

#### 2. Update wrangler.toml

Edit `wrangler.toml` and replace:
- `account_id` - Your Cloudflare account ID
- `database_id` - D1 database ID from step 1
- `id` (KV namespace) - KV namespace ID from step 1

#### 3. Set Environment Variables

Edit `.env` with your values:

```bash
# Required
GEMINI_API_KEY=your-gemini-api-key

# Optional (for email delivery)
# RESEND_API_KEY=re_your_key
# EMAIL_FROM=briefings@yourdomain.com
# EMAIL_TO=you@example.com
```

#### 4. Set Cloudflare Secrets

```bash
# Set Gemini API key as secret
echo "your-gemini-api-key" | npx wrangler secret put GEMINI_API_KEY

# Optional: Set Resend API key
# echo "your-resend-key" | wrangler secret put RESEND_API_KEY
```

### Database Setup

```bash
# Apply migrations to remote D1
pnpm run db:migrate:remote

# Copy example feeds config (edit with your own feeds)
cp config/feeds.example.yaml config/feeds.yaml

# Seed with sample feeds
pnpm run db:seed
```

### Deploy

```bash
# Deploy to Cloudflare Workers
pnpm run deploy

# Verify deployment
curl https://your-worker.workers.dev/health
```

## Usage

### Adding RSS Feeds

Edit `src/scripts/seed.ts` to add your feeds, then run:

```bash
pnpm run db:seed
```

Or add feeds directly to the D1 database using the Cloudflare dashboard or CLI:

```bash
wrangler d1 execute DB --remote --command="INSERT INTO Feed (id, name, url, isActive) VALUES (...)"
```

### Manual Triggers

You can manually trigger operations via HTTP endpoints:

```bash
# Fetch all feeds
curl -X POST https://your-worker.workers.dev/run/feed-fetch

# Generate daily summary
curl -X POST https://your-worker.workers.dev/run/daily-summary \
  -H "Content-Type: application/json" \
  -d '{"date": "2025-01-18"}'

# Generate weekly digest
curl -X POST https://your-worker.workers.dev/run/weekly-digest \
  -H "Content-Type: application/json" \
  -d '{"weekEndDate": "2025-01-19"}'
```

### Automated Schedule

The system runs automatically via cron triggers (configured in `wrangler.toml`):

- **Feed Fetch**: Every 4 hours
- **Daily Summary**: 10 AM UTC daily (adjust for your timezone)
- **Feed Validation**: 6 AM UTC daily

Weekly digests are manually triggered or can be scheduled separately.

## Local Development

```bash
# Start dev server (connects to remote Cloudflare resources)
pnpm run dev

# Run type checking
pnpm run typecheck

# Run tests
pnpm run test
```

### Database Management

Database is hosted on Cloudflare D1. Use Wrangler to interact with it:

```bash
# Apply migrations to remote D1
pnpm run db:migrate:remote

# Seed database with sample feeds
pnpm run db:seed

# View database in browser (requires browser login)
wrangler d1 execute DB --remote --command="SELECT * FROM Feed LIMIT 10"
```

## Email Delivery (Optional)

To enable weekly digest emails via Resend:

1. Sign up for [Resend](https://resend.com)
2. Verify your sending domain
3. Get your API key
4. Set environment variables:

```bash
# In wrangler.toml [vars] section
EMAIL_FROM = "briefings@yourdomain.com"
EMAIL_TO = "you@example.com,team@example.com"  # comma-separated

# As Cloudflare secret
echo "your-resend-api-key" | wrangler secret put RESEND_API_KEY
```

Weekly digests will automatically be sent when generated. The `sentAt` timestamp is tracked in the database.

## AI Models

Briefings uses Google Gemini with model selection based on task complexity:

- **Daily Summaries**: `gemini-2.5-flash` (fast, efficient for short summaries)
- **Topic Extraction**: `gemini-2.5-flash` (quick analysis)
- **Title Generation**: `gemini-2.5-flash` (creative titles)
- **Weekly Digest**: `gemini-2.5-pro` (comprehensive analysis, better synthesis)

Models are configured in `src/lib/constants.ts`.

## Database Schema

Core tables:

- `Feed` - RSS feed sources
- `Article` - Fetched articles
- `DailySummary` - AI-generated daily summaries
- `WeeklySummary` - AI-generated weekly digests
- `ArticleSummaryRelation` - Many-to-many: articles ↔ daily summaries
- `DailyWeeklySummaryRelation` - Many-to-many: daily ↔ weekly summaries
- `PromptTemplate` - AI prompt templates

See `src/db/types.ts` for TypeScript types and `migrations/` for SQL schema.

## Prompts

AI prompts are defined inline in `src/lib/prompts.ts`:

- `DAILY_SUMMARY_PROMPT` - Template for daily article summaries
- `WEEKLY_DIGEST_PROMPT` - Template for weekly newsletter
- `TOPIC_EXTRACTION_PROMPT` - Extract topics from content
- `TITLE_GENERATOR_PROMPT` - Generate newsletter titles

Customize these prompts to match your newsletter style.

## Monitoring

```bash
# View real-time logs
pnpm run tail

# Check queue metrics
# Visit: Cloudflare Dashboard > Queues

# Check D1 database
wrangler d1 execute DB --remote --command="SELECT COUNT(*) FROM Feed"
```

## Troubleshooting

### Build Issues

```bash
# Clear node_modules and reinstall
rm -rf node_modules pnpm-lock.yaml
pnpm install

# Regenerate types
pnpm run typecheck
```

### Queue Issues

If queues aren't processing:
1. Check Cloudflare Dashboard > Queues for backlogs
2. Verify queue consumers are deployed
3. Check logs with `pnpm run tail`

### Database Issues

```bash
# Check migrations status
wrangler d1 migrations list DB

# Force re-apply migrations
pnpm run db:migrate:remote
```

## Project Structure

```
briefings/
├── src/
│   ├── db/              # Database schema (Kysely ORM)
│   ├── lib/             # Core utilities (logger, errors, prompts, email)
│   ├── services/        # Business logic (feeds, summarization)
│   ├── server-functions/
│   │   ├── crons/       # Cron job handlers
│   │   ├── http/        # HTTP endpoint handlers
│   │   └── queues/      # Queue consumers
│   ├── scripts/         # Database seeding, migrations
│   ├── types/           # TypeScript types
│   └── index.ts         # Worker entry point
├── migrations/          # Database migrations
├── wrangler.toml        # Cloudflare Workers config
├── package.json
└── README.md
```

## Popular Use Cases

Briefings is flexible and can be customized for various newsletter and digest scenarios:

### 1. Substack Digest

Create a daily or weekly digest of your favorite Substack newsletters:

- Aggregate multiple Substack feeds into one curated newsletter
- AI-generated summaries help readers quickly scan content
- Weekly compilation creates a "best of" roundup

**Example feeds:**
- Industry thought leaders' Substacks
- Niche newsletters in your area of interest
- Competitor analysis feeds

### 2. Industry News Digest

Stay informed about your industry without spending hours reading:

- Tech, finance, healthcare, energy, aviation—any industry
- Automatic categorization by feed source
- AI-extracted key insights and trends

**Example feeds:**
- Trade publications (TechCrunch, VentureBeat, Aviation Week)
- Company blogs and press releases
- Regulatory/government feeds

### 3. Competitive Intelligence

Monitor competitors and market movements:

- Track competitor announcements and blog posts
- Monitor news coverage and industry analysis
- Weekly summaries highlight strategic shifts

### 4. Research & Development Tracker

Keep up with academic and technical research:

- arXiv, MIT Technology Review, Interesting Engineering
- Automatic topic extraction and categorization
- Build a searchable archive of key developments

### 5. Investment Research

Create investment thesis digests:

- Track sector-specific news and analysis
- Monitor earnings calls and executive communications
- Weekly synthesis of market-moving developments

### 6. Personal Knowledge Base

Build your own AI-curated reading list:

- Curate feeds from your areas of interest
- Daily summaries help you stay current
- Weekly digests create a monthly archive

### Customization Tips

- **Categories**: Group feeds by topic for better organization
- **Prompts**: Customize AI prompts in `src/lib/prompts.ts` for your voice
- **Frequency**: Adjust cron schedules for daily vs. weekly digest
- **Email**: Configure Resend for automated delivery to your inbox

## Future Ideas

A few directions that could extend Briefings beyond RSS but never made it off the backlog:

- **Non-RSS web content** -- Many valuable sources don't publish feeds. A scraping or extraction layer (using headless browsers or readability parsers) could ingest arbitrary web pages, newsletters delivered to a catch-all inbox, or content behind paywalls with authenticated sessions.
- **SaaS and productivity tool integrations** -- A lot of signal lives inside tools people already use: Google Docs, Notion databases, Slack channels, Linear/Jira updates, Confluence wikis, and similar. Connectors for these sources would let Briefings summarize internal knowledge alongside public content, turning it into a true "everything digest" rather than an RSS-only tool.

Both would benefit from a pluggable source adapter pattern so new integrations could be added without touching the core summarization pipeline.

## Contributing

This is an open-source project. Contributions welcome!

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Acknowledgments

- Built with [Cloudflare Workers](https://workers.cloudflare.com/)
- AI powered by [Google Gemini](https://ai.google.dev/)
- Email delivery via [Resend](https://resend.com)
- Database by [Kysely ORM](https://github.com/kysely-org/kysely)
