/**
 * Prompt templates for Briefings
 *
 * Loaded from config/prompts.yaml at build time via wrangler's text module rules.
 * To change prompts, edit config/prompts.yaml and redeploy.
 */

import Mustache from 'mustache';
import promptsYaml from '../../config/prompts.yaml';
import profileYaml from '../../config/profile.yaml';
import { parsePromptsConfig, formatProfileForPrompt, type PromptType } from './config.js';

const prompts = parsePromptsConfig(promptsYaml);
const profileContext = formatProfileForPrompt(profileYaml);

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
 * Get recipient profile context for personalizing prompts
 * Returns formatted profile text or empty string if no profile configured
 */
export function getProfileContext(): string {
  return profileContext;
}

/**
 * Render a prompt template with Mustache-style variables
 * Uses proper Mustache library to handle loops ({{#items}}...{{/items}})
 */
export function renderPrompt(template: string, data: Record<string, unknown>): string {
  return Mustache.render(template, data);
}
