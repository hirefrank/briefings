-- Migration: Add template types and additional prompt fields
-- This allows categorizing prompts by their purpose and selecting different prompts for different parts of the weekly summary

-- Add templateType column to PromptTemplate table
ALTER TABLE PromptTemplate ADD COLUMN templateType TEXT DEFAULT 'weekly-summary';

-- Add new prompt name fields to WeeklySummaryInstance
ALTER TABLE WeeklySummaryInstance ADD COLUMN topicPromptName TEXT DEFAULT 'topic-extraction';
ALTER TABLE WeeklySummaryInstance ADD COLUMN titlePromptName TEXT DEFAULT 'beef-title-generator';

-- Update existing prompt templates with their types
UPDATE PromptTemplate SET templateType = 'weekly-summary' WHERE name = 'weekly-beef-recap';
UPDATE PromptTemplate SET templateType = 'daily-summary' WHERE name = 'daily-summary';
UPDATE PromptTemplate SET templateType = 'topic-extraction' WHERE name = 'topic-extraction';
UPDATE PromptTemplate SET templateType = 'title-generator' WHERE name = 'beef-title-generator';

-- Create index for efficient filtering by template type
CREATE INDEX IF NOT EXISTS idx_prompt_template_type ON PromptTemplate(templateType);