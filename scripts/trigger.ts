/**
 * API Trigger Scripts
 * Reads API_KEY from .env and triggers Briefings endpoints
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

interface EnvVars {
  API_KEY: string;
  WORKER_URL: string;
}

function loadEnv(): EnvVars {
  const envPath = resolve(process.cwd(), '.env');
  const envContent = readFileSync(envPath, 'utf-8');
  
  const vars: Record<string, string> = {};
  envContent.split('\n').forEach(line => {
    const match = line.match(/^([A-Z_]+)=(.+)$/);
    if (match) {
      vars[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  });

  if (!vars.API_KEY) {
    throw new Error('API_KEY not found in .env file');
  }

  // Get worker name from wrangler.toml
  let workerName = 'briefings';
  try {
    const wranglerPath = resolve(process.cwd(), 'wrangler.toml');
    const wranglerContent = readFileSync(wranglerPath, 'utf-8');
    const nameMatch = wranglerContent.match(/^name = "(.+)"$/m);
    if (nameMatch) {
      workerName = nameMatch[1];
    }
  } catch {
    // Use default
  }

  return {
    API_KEY: vars.API_KEY,
    WORKER_URL: `https://${workerName}.hirefrank.workers.dev`,
  };
}

async function makeRequest(url: string, apiKey: string, body?: object): Promise<void> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'X-API-Key': apiKey,
      'Content-Type': 'application/json',
    },
    ...(body && { body: JSON.stringify(body) }),
  });

  const data = await response.json();
  console.log(JSON.stringify(data, null, 2));

  if (!response.ok) {
    process.exit(1);
  }
}

// CLI entry point
const command = process.argv[2];
const arg = process.argv[3];

async function main() {
  const env = loadEnv();

  switch (command) {
    case 'feed-fetch':
      console.log(`Triggering feed fetch at ${env.WORKER_URL}...`);
      await makeRequest(`${env.WORKER_URL}/api/run/feed-fetch`, env.API_KEY);
      break;

    case 'daily-summary': {
      // Default to yesterday
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const date = arg || yesterday.toISOString().split('T')[0];
      
      // Check for --force flag
      const force = process.argv.includes('--force');
      
      console.log(`Triggering daily summary for ${date}${force ? ' (force)' : ''}...`);
      await makeRequest(`${env.WORKER_URL}/api/run/daily-summary`, env.API_KEY, { date, force });
      break;
    }

    case 'weekly-summary': {
      // Default to last Sunday
      const today = new Date();
      const lastSunday = new Date(today);
      lastSunday.setDate(today.getDate() - today.getDay());
      const weekEnd = arg || lastSunday.toISOString().split('T')[0];
      
      // Calculate week start (6 days before end for a full week)
      const weekEndDate = new Date(weekEnd);
      const weekStartDate = new Date(weekEndDate);
      weekStartDate.setDate(weekEndDate.getDate() - 6);
      
      const weekStart = weekStartDate.toISOString().split('T')[0];
      
      console.log(`Triggering weekly digest for week ${weekStart} to ${weekEnd}...`);
      await makeRequest(`${env.WORKER_URL}/api/run/weekly-summary`, env.API_KEY, { 
        weekStartDate: weekStart, 
        weekEndDate: weekEnd 
      });
      break;
    }

    default:
      console.log(`Usage: pnpm trigger <command> [arg]

Commands:
  feed-fetch                    Trigger feed fetch
  daily-summary [YYYY-MM-DD]    Trigger daily summary (default: yesterday)
  weekly-summary [YYYY-MM-DD]   Trigger weekly digest (default: last Sunday)

Examples:
  pnpm trigger feed-fetch
  pnpm trigger daily-summary 2025-01-28
  pnpm trigger weekly-summary 2025-01-26
`);
      process.exit(1);
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
