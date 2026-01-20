import { getDb, setupDb, feeds } from '../db.js';
import { Logger } from '../lib/logger.js';

export async function seedDatabase(env: Env): Promise<void> {
  const logger = Logger.forService('DatabaseSeeder');

  logger.info('Starting database seed');

  await setupDb(env);
  const db = getDb(env);

  // Seed some example feeds
  const exampleFeeds = [
    { name: 'TechCrunch', url: 'https://techcrunch.com/feed/', category: 'Technology' },
    { name: 'Hacker News', url: 'https://news.ycombinator.com/rss', category: 'Technology' },
    { name: 'Wired', url: 'https://www.wired.com/feed/rss', category: 'Technology' },
  ];

  for (const feed of exampleFeeds) {
    try {
      await db
        .insert(feeds)
        .values({
          name: feed.name,
          url: feed.url,
          category: feed.category,
          isActive: true,
        })
        .onConflictDoNothing();
    } catch {
      logger.warn('Feed already exists', { feed: feed.name });
    }
  }

  logger.info('Database seeding completed');
}
