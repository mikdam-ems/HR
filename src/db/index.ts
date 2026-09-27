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

const POSTGRES = /^postgres(ql)?:\/\//;

/**
 * The PostgreSQL connection string. Hosts use different names (Vercel's Neon integration can add a
 * prefix such as STORAGE_URL), so take the first well-known name holding a real postgres:// address,
 * then any other variable that does. A leftover non-database DATABASE_URL is skipped.
 */
export function databaseUrl(): string | undefined {
  const preferred = ['DATABASE_URL', 'POSTGRES_URL', 'NEON_DATABASE_URL'];
  const others = Object.keys(process.env)
    .filter((k) => !preferred.includes(k) && /URL/.test(k))
    // Pooled connections first; unpooled ones also work.
    .sort((a, b) => Number(/UNPOOLED|NON_POOLING/.test(a)) - Number(/UNPOOLED|NON_POOLING/.test(b)));
  for (const key of [...preferred, ...others]) {
    const value = process.env[key];
    if (value && POSTGRES.test(value)) return value;
  }
  // Local development: DATABASE_URL=memory or an embedded-database path.
  return process.env.DATABASE_URL || undefined;
}

/** Serverless hosts have no lasting disk, so the embedded database can't work there. */
const serverless = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

/**
 * DATABASE_URL=postgres://… uses a real PostgreSQL server (production, shared dev).
 * Anything else (or unset) uses PGlite, an embedded PostgreSQL stored in PGLITE_DIR — zero setup for local dev.
 */
export async function createDb(url = databaseUrl()): Promise<DB> {
  if (url?.startsWith('postgres')) {
    const db = drizzlePg(new Pool({ connectionString: url }), { schema });
    await migratePg(db, { migrationsFolder: MIGRATIONS });
    return db;
  }
  if (serverless && url !== 'memory') {
    throw new Error(
      'No database connected. In Vercel: Storage → connect a Neon (Postgres) database to this project, then redeploy.',
    );
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
  globalForDb.__emsDb ??= createDb()
    .then(async (db) => {
      if (process.env.DEMO_MODE === 'true') {
        // Loaded lazily to keep the database module free of app logic.
        const { ensureDemoData } = await import('@/server/seed');
        await ensureDemoData(db);
      }
      return db;
    })
    .catch((e) => {
      // Don't cache a failure: the next request tries again (e.g. after the database is connected).
      globalForDb.__emsDb = undefined;
      throw e;
    });
  return globalForDb.__emsDb;
}

export { schema };
