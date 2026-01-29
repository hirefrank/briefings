#!/usr/bin/env tsx
/**
 * Feed sync script — syncs config/feeds.yaml ↔ D1.
 *
 * Usage: pnpm sync:feeds [--env production]
 *
 * 1. Reads config/feeds.yaml (local source of truth)
 * 2. Reads all feeds from remote D1 via wrangler d1 execute
 * 3. Upserts: feeds in YAML are upserted to D1
 * 4. Deactivates: feeds in D1 but not in YAML get isActive=0
 * 5. Appends deactivated feeds back to YAML with active: false
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { parse, stringify } from 'yaml';
import { parseFeedsConfig, type FeedEntry } from '../lib/config.js';

const FEEDS_YAML_PATH = resolve(process.cwd(), 'config/feeds.yaml');

interface D1Feed {
  id: string;
  name: string;
  url: string;
  category: string | null;
  isActive: number;
}

interface YamlFeedEntry extends FeedEntry {
  active?: boolean;
}

function runD1Query(sql: string, env?: string): unknown[] {
  const envFlag = env ? `--env ${env}` : '';
  const cmd = `wrangler d1 execute DB --remote ${envFlag} --json --command="${sql.replace(/"/g, '\\"')}"`;
  const output = execSync(cmd, { encoding: 'utf-8' });
  const parsed = JSON.parse(output);
  // wrangler d1 execute --json returns an array of result sets
  if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].results) {
    return parsed[0].results;
  }
  return [];
}

function main() {
  const envArg = process.argv.includes('--env')
    ? process.argv[process.argv.indexOf('--env') + 1]
    : undefined;

  console.log('--- Feed Sync ---');
  console.log(`YAML: ${FEEDS_YAML_PATH}`);
  if (envArg) console.log(`Environment: ${envArg}`);

  // 1. Read local YAML
  const yamlContent = readFileSync(FEEDS_YAML_PATH, 'utf-8');
  const yamlFeeds = parseFeedsConfig(yamlContent);
  console.log(`Local feeds: ${yamlFeeds.length}`);

  // 2. Read remote D1 feeds
  const d1Feeds = runD1Query(
    'SELECT id, name, url, category, isActive FROM Feed',
    envArg
  ) as D1Feed[];
  console.log(`Remote feeds: ${d1Feeds.length}`);

  const d1ByUrl = new Map(d1Feeds.map((f) => [f.url, f]));
  const yamlUrls = new Set(yamlFeeds.map((f) => f.url));

  // 3. Upsert: feeds in YAML → D1
  let upserted = 0;
  for (const feed of yamlFeeds) {
    const existing = d1ByUrl.get(feed.url);
    if (existing) {
      // Update name/category/reactivate
      const sets: string[] = [];
      if (existing.name !== feed.name) sets.push(`name='${feed.name.replace(/'/g, "''")}'`);
      if (existing.category !== (feed.category || 'General'))
        sets.push(`category='${(feed.category || 'General').replace(/'/g, "''")}'`);
      if (existing.isActive !== 1) sets.push('isActive=1');
      sets.push(`updatedAt=${Date.now()}`);

      if (sets.length > 0) {
        runD1Query(
          `UPDATE Feed SET ${sets.join(', ')} WHERE url='${feed.url.replace(/'/g, "''")}'`,
          envArg
        );
        upserted++;
      }
    } else {
      // Insert new feed
      const id = crypto.randomUUID();
      const now = Date.now();
      const name = feed.name.replace(/'/g, "''");
      const url = feed.url.replace(/'/g, "''");
      const category = (feed.category || 'General').replace(/'/g, "''");
      runD1Query(
        `INSERT INTO Feed (id, name, url, category, isActive, isValid, errorCount, createdAt, updatedAt) VALUES ('${id}', '${name}', '${url}', '${category}', 1, 1, 0, ${now}, ${now})`,
        envArg
      );
      upserted++;
    }
  }
  console.log(`Upserted: ${upserted}`);

  // 4. Deactivate: feeds in D1 but not in YAML
  const deactivated: D1Feed[] = [];
  for (const d1Feed of d1Feeds) {
    if (!yamlUrls.has(d1Feed.url) && d1Feed.isActive === 1) {
      runD1Query(
        `UPDATE Feed SET isActive=0, updatedAt=${Date.now()} WHERE id='${d1Feed.id}'`,
        envArg
      );
      deactivated.push(d1Feed);
    }
  }
  console.log(`Deactivated: ${deactivated.length}`);

  // 5. Append deactivated feeds to YAML (if any)
  if (deactivated.length > 0) {
    const rawYaml = parse(yamlContent) as { feeds: YamlFeedEntry[] };
    for (const d of deactivated) {
      // Only append if not already in YAML
      if (!rawYaml.feeds.some((f) => f.url === d.url)) {
        rawYaml.feeds.push({
          name: d.name,
          url: d.url,
          category: d.category || 'General',
          active: false,
        });
      }
    }
    writeFileSync(FEEDS_YAML_PATH, stringify(rawYaml, { lineWidth: 120 }), 'utf-8');
    console.log('Updated feeds.yaml with deactivated feeds');
  }

  console.log('--- Done ---');
}

main();
