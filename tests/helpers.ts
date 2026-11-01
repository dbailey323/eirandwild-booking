import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '@/db/schema';
import type { Db } from '@/lib/booking';

// A fresh in-memory Postgres with the real migrations applied
export async function testDb(): Promise<Db> {
  const client = new PGlite();
  const dir = path.resolve(__dirname, '../drizzle');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    for (const statement of readFileSync(path.join(dir, file), 'utf8').split('--> statement-breakpoint')) {
      if (statement.trim()) await client.exec(statement);
    }
  }
  return drizzle(client, { schema }) as unknown as Db;
}

export async function seedBasics(db: Db) {
  const [library] = await db.insert(schema.locations).values({ name: 'Mountsorrel Library', address: 'The Green, LE12 7AS' }).returning();
  const [dance] = await db
    .insert(schema.classTypes)
    .values({ slug: 'dance-tone', name: 'Dance & Tone', group: 'womanhood', defaultPricePence: 700, defaultCapacity: 2, defaultLocationId: library.id })
    .returning();
  const [massage] = await db
    .insert(schema.classTypes)
    .values({ slug: 'baby-massage', name: 'Baby Massage & Mummy Relaxation', group: 'babymassage', defaultPricePence: 5000, defaultCapacity: 6 })
    .returning();
  return { library, dance, massage };
}

export const alice = { email: 'Alice@Example.com', name: 'Alice', phone: '07000 000001' };
export const bea = { email: 'bea@example.com', name: 'Bea' };
export const cat = { email: 'cat@example.com', name: 'Cat' };
