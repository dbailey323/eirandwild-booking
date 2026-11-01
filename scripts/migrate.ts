// Creates or updates the database tables: npm run db:migrate
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

// Neon also provides a direct (unpooled) connection, which is better for migrations
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
const client = postgres(url, { max: 1 });
await migrate(drizzle(client), { migrationsFolder: 'drizzle' });
await client.end();
console.log('Database is up to date');
