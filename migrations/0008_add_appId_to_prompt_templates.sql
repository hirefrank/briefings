-- Migration number: 0008 	 2025-07-27T21:44:46.308Z
-- Add appId field to PromptTemplate table to support multiple apps
ALTER TABLE PromptTemplate ADD COLUMN appId TEXT DEFAULT 'briefings';

-- Create index for appId filtering
CREATE INDEX IF NOT EXISTS PromptTemplate_appId_idx ON PromptTemplate(appId);