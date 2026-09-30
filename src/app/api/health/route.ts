import { sql } from 'drizzle-orm';
import { databaseUrl, getDb } from '@/db';
import { version } from '../../../../package.json';

export const dynamic = 'force-dynamic';

/**
 * Open /api/health to see whether the site can reach its database, and which version is running (the same number as
 * the changelog and the GitHub Release). Reveals no data or secrets.
 */
export async function GET() {
  const url = databaseUrl();
  const database = url ? 'postgres' : 'embedded (local development)';
  try {
    const db = await getDb();
    const [row] = (await db.execute(sql`select count(*)::int as people from employees`)).rows as { people: number }[];
    return Response.json({ ok: true, version, database, people: row?.people ?? 0, demoMode: process.env.DEMO_MODE === 'true' });
  } catch (e) {
    return Response.json(
      { ok: false, version, database, error: e instanceof Error ? e.message : String(e), demoMode: process.env.DEMO_MODE === 'true' },
      { status: 503 },
    );
  }
}
