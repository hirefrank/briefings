-- Migration: Add structured content support to daily summaries
-- This adds new fields for structured JSON output while maintaining backward compatibility

-- Add structured content field (JSON)
ALTER TABLE daily_summaries ADD COLUMN structured_content TEXT;

-- Add schema version for future migrations
ALTER TABLE daily_summaries ADD COLUMN schema_version TEXT DEFAULT '1.0';

-- Add denormalized fields for search and filtering
ALTER TABLE daily_summaries ADD COLUMN sentiment REAL;
ALTER TABLE daily_summaries ADD COLUMN topics_list TEXT;
ALTER TABLE daily_summaries ADD COLUMN entity_list TEXT;
ALTER TABLE daily_summaries ADD COLUMN article_count INTEGER DEFAULT 0;

-- Create indexes for new fields
CREATE INDEX IF NOT EXISTS DailySummary_sentiment_idx ON daily_summaries(sentiment);
CREATE INDEX IF NOT EXISTS DailySummary_schemaVersion_idx ON daily_summaries(schema_version);