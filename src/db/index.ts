import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type Database = ReturnType<typeof createDb>;

export function createDb(url: string) {
  // prepare: false keeps it compatible with pooled (PgBouncer) connection strings
  const client = postgres(url, { prepare: false, max: 5 });
  return drizzle(client, { schema });
}

let cached: Database | undefined;

// The app's shared connection, created on first use
export function getDb(): Database {
  if (!cached) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    cached = createDb(url);
  }
  return cached;
}
