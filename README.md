# Briefings OSS

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
┌─────────────┐
│  Cron Jobs  │──┐
└─────────────┘  │
                 ▼
         ┌────────────────┐
         │ Feed Fetch     │
         │ Queue Consumer │
         └────────┬───────┘
                  │
                  ▼
         ┌────────────────┐
         │ Daily Summary  │
         │ Queue Pipeline │
         └────────┬───────┘
                  │
                  ▼
         ┌────────────────┐      ┌──────────────┐
         │ Weekly Digest  │─────▶│ Resend Email │
         │ Consumer       │      │ (Optional)   │
         └────────┬───────┘      └──────────────┘
                  │
                  ▼
         ┌────────────────┐
         │ R2 Storage     │
         │ (History)      │
         └────────────────┘
```

**Queue Structure (4 queues):**
1. `briefings-feed-fetch` - Fetch articles from RSS feeds
2. `briefings-daily-summary-initiator` - Trigger daily summary generation
3. `briefings-daily-summary-processor` - Generate AI summaries for articles
4. `briefings-weekly-digest` - Create weekly recap and send email

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
wrangler d1 create briefings-db
# Copy the database_id to wrangler.toml

# Create KV namespace
wrangler kv:namespace create APP_CONFIG_KV
# Copy the id to wrangler.toml

# Create R2 bucket
wrangler r2 bucket create briefings-markdown-output
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
CLOUDFLARE_ACCOUNT_ID=your-account-id
CLOUDFLARE_DATABASE_ID=your-database-id
CLOUDFLARE_D1_TOKEN=your-api-token

# Optional (for email delivery)
# RESEND_API_KEY=re_your_key
# EMAIL_FROM=briefings@yourdomain.com
# EMAIL_TO=you@example.com
```

#### 4. Set Cloudflare Secrets

```bash
# Set Gemini API key as secret
echo "your-gemini-api-key" | wrangler secret put GEMINI_API_KEY

# Optional: Set Resend API key
# echo "your-resend-key" | wrangler secret put RESEND_API_KEY
```

### Database Setup

```bash
# Generate migrations (if schema changed)
pnpm run db:generate

# Apply migrations to remote D1
pnpm run db:migrate:remote

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

Or add feeds directly to the D1 database via Drizzle Studio:

```bash
pnpm run db:studio
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
# Start dev server
pnpm run dev

# Open Drizzle Studio (database GUI)
pnpm run db:studio

# Run type checking
pnpm run typecheck

# Run tests
pnpm run test
```

### Local Database

For local development, use local D1:

```bash
# Apply migrations locally
pnpm run db:migrate:local

# Seed local database
pnpm run db:seed
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

- **Daily Summaries**: `gemini-2.0-flash-exp` (fast, efficient for short summaries)
- **Topic Extraction**: `gemini-2.0-flash-exp` (quick analysis)
- **Title Generation**: `gemini-2.0-flash-exp` (creative titles)
- **Weekly Digest**: `gemini-1.5-pro` (comprehensive analysis, better synthesis)

Models are configured in `src/lib/constants.ts`.

## Database Schema

Core tables:

- `Feed` - RSS feed sources
- `Article` - Fetched articles
- `DailySummary` - AI-generated daily summaries
- `WeeklySummary` - AI-generated weekly digests

See `src/db/schema.ts` for full schema.

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
pnpm run db:studio
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
│   ├── db/              # Database schema (Drizzle ORM)
│   ├── lib/             # Core utilities (logger, errors, prompts, email)
│   ├── services/        # Business logic (feeds, summarization)
│   ├── server-functions/
│   │   ├── crons/       # Cron job handlers
│   │   ├── http/        # HTTP endpoint handlers
│   │   └── queues/      # Queue consumers
│   ├── scripts/         # Database seeding, migrations
│   ├── types/           # TypeScript types
│   └── index.ts         # Worker entry point
├── migrations/          # Drizzle migrations
├── wrangler.toml        # Cloudflare Workers config
├── package.json
└── README.md
```

## Contributing

This is an open-source project. Contributions welcome!

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT License - see LICENSE file for details

## Acknowledgments

- Built with [Cloudflare Workers](https://workers.cloudflare.com/)
- AI powered by [Google Gemini](https://ai.google.dev/)
- Email delivery via [Resend](https://resend.com)
- Database by [Drizzle ORM](https://orm.drizzle.team/)
