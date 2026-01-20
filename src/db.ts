import { drizzle } from 'drizzle-orm/d1';
import { sql } from 'drizzle-orm';
// Import schema from local db module
import { schema } from './db/schema.js';

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let _env: Env | null = null;

export function getDb(env: Env) {
  if (!_db || _env !== env) {
    _db = drizzle(env.DB, { schema });
    _env = env;
  }
  return _db;
}

export async function setupDb(env: Env) {
  // Initialize the database connection
  const db = getDb(env);

  // Drizzle doesn't require async initialization like Prisma
  // The connection is established lazily on first query

  return db;
}

// Backward compatibility: Create a db proxy that gets the actual db from the environment
export const db = new Proxy({} as ReturnType<typeof getDb>, {
  get(target, prop) {
    if (!_db) {
      throw new Error('Database not initialized. Call setupDb(env) first.');
    }

    // Handle special Prisma methods
    if (prop === '$queryRaw') {
      return async (strings: TemplateStringsArray, ..._values: unknown[]) => {
        // Convert template literal to sql
        let query = strings[0];
        for (let i = 0; i < _values.length; i++) {
          query += _values[i] + strings[i + 1];
        }
        return _db.run(sql.raw(query));
      };
    }

    // Handle table access
    if (typeof prop === 'string' && prop in schema) {
      return (_db as any)[prop];
    }

    // Pass through other properties
    return (_db as any)[prop as any];
  },
});

// Export schema and types
export * from './db/schema.js';
export type Db = ReturnType<typeof getDb>;
