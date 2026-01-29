import { Kysely } from 'kysely';
import { D1Dialect } from 'kysely-d1';
import type { Database } from './db/types.js';

export type Db = Kysely<Database>;

let _db: Db | null = null;
let _env: Env | null = null;

export function getDb(env: Env): Db {
  if (!_db || _env !== env) {
    _db = new Kysely<Database>({ dialect: new D1Dialect({ database: env.DB }) });
    _env = env;
  }
  return _db;
}

export async function setupDb(env: Env): Promise<Db> {
  return getDb(env);
}

// Re-export types for convenience
export type {
  Database,
  Feed,
  Article,
  DailySummary,
  WeeklySummary,
} from './db/types.js';
