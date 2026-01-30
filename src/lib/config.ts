/**
 * YAML config loader for feeds and prompts.
 *
 * Config files live in config/ at the project root:
 *   - config/feeds.yaml      (gitignored — your actual feeds)
 *   - config/prompts.yaml    (gitignored — your actual prompts)
 *   - config/*.example.yaml  (checked in — templates)
 *
 * These are imported at build time and bundled into the worker.
 * To change config, edit the YAML and redeploy.
 */

import { parse } from 'yaml';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Feeds config
// ---------------------------------------------------------------------------

const FeedEntrySchema = z.object({
  name: z.string(),
  url: z.string().url(),
  category: z.string().optional().default('General'),
});

const FeedsConfigSchema = z.object({
  feeds: z.array(FeedEntrySchema).min(1),
});

export type FeedEntry = z.infer<typeof FeedEntrySchema>;

export function parseFeedsConfig(yamlContent: string): FeedEntry[] {
  const raw = parse(yamlContent);
  const config = FeedsConfigSchema.parse(raw);
  return config.feeds;
}

// ---------------------------------------------------------------------------
// Prompts config
// ---------------------------------------------------------------------------

const PromptEntrySchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  template: z.string(),
});

const PromptsConfigSchema = z.object({
  'daily-summary': PromptEntrySchema,
  'weekly-digest': PromptEntrySchema,
});

export type PromptType = keyof z.infer<typeof PromptsConfigSchema>;

export function parsePromptsConfig(yamlContent: string): Record<PromptType, string> {
  const raw = parse(yamlContent);
  const config = PromptsConfigSchema.parse(raw);
  return {
    'daily-summary': config['daily-summary'].template,
    'weekly-digest': config['weekly-digest'].template,
  };
}

// ---------------------------------------------------------------------------
// Profile config (optional - for personalizing newsletter voice)
// ---------------------------------------------------------------------------

export function parseProfileConfig(yamlContent: string): string {
  // Profile is freeform text to inject into prompts
  return yamlContent.trim();
}

export function formatProfileForPrompt(profileYaml: string): string {
  if (!profileYaml || profileYaml.trim().length === 0) {
    return '';
  }
  
  // Extract key sections for the prompt
  const lines = profileYaml.split('\n');
  const relevantLines: string[] = [];
  let inRelevantSection = false;
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Skip comments and empty lines
    if (trimmed.startsWith('#') || trimmed === '') {
      continue;
    }
    
    // Start capturing at recipient section
    if (trimmed === 'recipient:') {
      inRelevantSection = true;
    }
    
    if (inRelevantSection) {
      relevantLines.push(line);
    }
  }
  
  return relevantLines.join('\n').trim();
}
