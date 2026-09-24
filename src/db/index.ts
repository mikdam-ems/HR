import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { drizzle as drizzlePg, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { PGlite } from '@electric-sql/pglite';
import { Pool } from 'pg';
import * as schema from './schema';

/** Both drivers expose the same query API; the app only sees this type. */
export type DB = NodePgDatabase<typeof schema>;

const MIGRATIONS = path.join(process.cwd(), 'drizzle');

/**
 * DATABASE_URL=postgres://… uses a real PostgreSQL server (production, shared dev).
 * Anything else (or unset) uses PGlite, an embedded PostgreSQL stored in PGLITE_DIR — zero setup for local dev.
 */
export async function createDb(url = process.env.DATABASE_URL): Promise<DB> {
  if (url?.startsWith('postgres')) {
    const db = drizzlePg(new Pool({ connectionString: url }), { schema });
    await migratePg(db, { migrationsFolder: MIGRATIONS });
    return db;
  }
  const dir = url === 'memory' ? undefined : (process.env.PGLITE_DIR ?? path.join(process.cwd(), '.data', 'pglite'));
  if (dir) mkdirSync(dir, { recursive: true });
  const db = drizzlePglite(new PGlite(dir), { schema });
  await migratePglite(db, { migrationsFolder: MIGRATIONS });
  return db as unknown as DB;
}

const globalForDb = globalThis as unknown as { __emsDb?: Promise<DB> };

/** One shared connection per server process (survives Next.js hot reloads in dev). */
export function getDb(): Promise<DB> {
  globalForDb.__emsDb ??= createDb();
  return globalForDb.__emsDb;
}

export { schema };
