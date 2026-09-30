/**
 * First-run setup: calendars, the EMS Internal client, default settings and the first admin.
 * Client companies (e.g. the clients people are placed with) are added on the Clients page.
 *   SEED_ADMIN_EMAIL=you@ems-itech.com npm run db:seed
 *   npm run db:seed -- --demo      also adds a made-up team and client (for local development and demos)
 */
import { createDb } from '@/db';
import { ensureAdmin, seedAll, seedDemo } from '@/server/seed';

const demo = process.argv.includes('--demo');

async function main() {
  const db = await createDb();
  await seedAll(db);
  if (process.env.SEED_ADMIN_EMAIL) await ensureAdmin(db, process.env.SEED_ADMIN_EMAIL);
  else if (!demo) console.log('! Set SEED_ADMIN_EMAIL to create the first admin.');
  if (demo) await seedDemo(db);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
