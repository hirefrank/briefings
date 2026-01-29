/**
 * Prompt templates for Briefings
 *
 * Loaded from config/prompts.yaml at build time via wrangler's text module rules.
 * To change prompts, edit config/prompts.yaml and redeploy.
 */

import promptsYaml from '../../config/prompts.yaml';
import { parsePromptsConfig, type PromptType } from './config.js';

const prompts = parsePromptsConfig(promptsYaml);

/**
 * Get prompt template by type
 */
export function getPrompt(type: PromptType): string {
  const template = prompts[type];
  if (!template) {
    throw new Error(`Unknown prompt type: ${type}`);
  }
  return template;
}

/**
 * Render a prompt template with Mustache-style variables
 */
export function renderPrompt(template: string, data: Record<string, unknown>): string {
  let result = template;

  // Simple Mustache-style variable replacement
  for (const [key, value] of Object.entries(data)) {
    const pattern = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    result = result.replace(pattern, String(value ?? ''));
  }

  return result;
}
