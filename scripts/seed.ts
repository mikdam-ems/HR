/**
 * First-run setup: calendars, the EMS Internal and Jadwa clients, default settings and the first admin.
 *   SEED_ADMIN_EMAIL=you@ems-itech.com npm run db:seed
 *   npm run db:seed -- --demo      also adds sample people (for local development and demos)
 */
import { createDb } from '@/db';
import { ensureAdmin, seedBase, seedDemo } from '@/server/seed';

const demo = process.argv.includes('--demo');

async function main() {
  const db = await createDb();
  await seedBase(db);
  if (process.env.SEED_ADMIN_EMAIL) await ensureAdmin(db, process.env.SEED_ADMIN_EMAIL);
  else if (!demo) console.log('! Set SEED_ADMIN_EMAIL to create the first admin.');
  if (demo) await seedDemo(db);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
