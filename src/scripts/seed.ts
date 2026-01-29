import { getDb, setupDb } from '../db.js';
import { Logger } from '../lib/logger.js';
import { parseFeedsConfig } from '../lib/config.js';
import feedsYaml from '../../config/feeds.yaml';

export async function seedDatabase(env: Env): Promise<void> {
  const logger = Logger.forService('DatabaseSeeder');

  logger.info('Starting database seed');

  await setupDb(env);
  const db = getDb(env);

  const feedEntries = parseFeedsConfig(feedsYaml);
  const now = Date.now();

  for (const feed of feedEntries) {
    try {
      await db
        .insertInto('Feed')
        .values({
          id: crypto.randomUUID(),
          name: feed.name,
          url: feed.url,
          category: feed.category,
          isActive: 1,
          isValid: 1,
          errorCount: 0,
          createdAt: now,
          updatedAt: now,
        })
        .onConflict((oc) => oc.doNothing())
        .execute();
    } catch {
      logger.warn('Feed already exists', { feed: feed.name });
    }
  }

  logger.info('Database seeding completed', { feedCount: feedEntries.length });
}
